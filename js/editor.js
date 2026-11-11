/* ============================================================
   Markdown Studio — editor.js
   The Markdown source editor.

   Architecture (classic "layered editor" technique):
   - A <textarea> holds the real text and receives all input. Its
     text color is transparent; only the caret and selection show.
   - A "mirror" <div> behind it renders the same text, highlighted
     with highlight.js. Because both layers share identical font
     metrics, padding and width, the highlight lines up perfectly
     with the invisible textarea text.
   - Line numbers are generated as ::before pseudo-elements of each
     logical line, so they follow soft-wrapped lines automatically.

   Also owns: undo/redo history, find & replace, smart Enter
   (list/quote continuation), Tab indent/dedent, IME composition.
   ============================================================ */

'use strict';

(function () {
  const MAX_HIGHLIGHT_CHARS = 120000; // beyond this, plain rendering
  const MAX_FIND_MATCHES = 2000;
  const HISTORY_LIMIT = 300;
  const MERGE_WINDOW_MS = 600;

  class Editor {
    /**
     * @param {HTMLElement} pane The scrollable editor pane element.
     * @param {{tabSize?: number, lineNumbers?: boolean}} [options]
     */
    constructor(pane, options) {
      this.pane = pane;
      this.opts = Object.assign({ tabSize: 2, lineNumbers: true }, options);
      this.listeners = { change: [], selection: [], scroll: [], history: [] };
      this.history = { stack: [], index: -1, lastPush: 0 };
      this.composing = false;
      this.applying = false;
      this.activeLineIndex = -1;
      this.findState = { query: '', caseSensitive: false, matches: [], current: -1 };
      this.lineEls = [];

      this.buildDom();
      this.bindEvents();
    }

    /* ---------- DOM ---------- */

    buildDom() {
      this.surface = document.createElement('div');
      this.surface.className = 'editor-surface';
      if (!this.opts.lineNumbers) this.surface.classList.add('no-line-numbers');

      this.mirror = document.createElement('div');
      this.mirror.className = 'editor-mirror';
      this.mirror.setAttribute('aria-hidden', 'true');

      this.textarea = document.createElement('textarea');
      this.textarea.className = 'editor-input';
      this.textarea.setAttribute('aria-label', 'Markdown source');
      this.textarea.setAttribute('autocomplete', 'off');
      this.textarea.setAttribute('autocorrect', 'off');
      this.textarea.setAttribute('autocapitalize', 'off');
      this.textarea.setAttribute('spellcheck', 'false');
      this.textarea.setAttribute('wrap', 'soft');
      this.textarea.setAttribute('placeholder', '# Start writing Markdown…');
      this.textarea.setAttribute('data-gramm', 'false'); // hint off Grammarly overlay

      this.surface.append(this.mirror, this.textarea);
      this.pane.append(this.surface);
    }

    /* ---------- Events ---------- */

    bindEvents() {
      const ta = this.textarea;

      ta.addEventListener('input', (e) => {
        if (!this.applying) this.record();
        this.emit('change', { source: 'input' });
        if (this.composing || e.isComposing) return; // mirror hidden while composing
        this.scheduleRender();
      });

      ta.addEventListener('compositionstart', () => {
        this.composing = true;
        this.surface.classList.add('composing');
      });

      ta.addEventListener('compositionend', () => {
        this.composing = false;
        this.surface.classList.remove('composing');
        this.render();
      });

      ta.addEventListener('keydown', (e) => this.onKeyDown(e));

      ta.addEventListener('paste', () => {
        // Paste content lands after the event; render on the next frame.
        this.scheduleRender();
      });

      // Pane scrolling (editor ↔ preview sync handled by the app).
      this.pane.addEventListener(
        'scroll',
        Utils.throttle(() => {
          this.emit('scroll', {
            scrollTop: this.pane.scrollTop,
            scrollHeight: this.pane.scrollHeight,
            clientHeight: this.pane.clientHeight,
          });
        }, 40)
      );

      // Selection / caret position tracking.
      document.addEventListener(
        'selectionchange',
        Utils.throttle(() => {
          if (document.activeElement !== this.textarea) return;
          this.updateActiveLine();
          this.emit('selection', this.getCursor());
        }, 60)
      );

      ta.addEventListener('scroll', () => {
        // The textarea should never scroll (it auto-sizes with the mirror),
        // but if a rounding error makes it, keep the mirror aligned.
        if (ta.scrollTop !== 0 || ta.scrollLeft !== 0) {
          this.mirror.style.transform =
            'translate(' + -ta.scrollLeft + 'px,' + -ta.scrollTop + 'px)';
        }
      });
    }

    onKeyDown(e) {
      if (this.composing) return;

      if (e.key === 'Tab') {
        this.handleTab(e);
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        this.handleEnter(e);
      }
    }

    /* ---------- Tab: indent / dedent ---------- */

    handleTab(e) {
      e.preventDefault();
      const ta = this.textarea;
      const { value, selectionStart: s, selectionEnd: en } = ta;
      const tab = ' '.repeat(this.opts.tabSize);
      const spansLines = s !== en && value.slice(s, en).includes('\n');

      if (spansLines) {
        const lineStart = value.lastIndexOf('\n', s - 1) + 1;
        let nl = value.indexOf('\n', en);
        const lineEnd = nl === -1 ? value.length : nl;
        const block = value.slice(lineStart, lineEnd);
        const lines = block.split('\n');

        const changed = lines.map((line) => {
          if (e.shiftKey) return line.replace(new RegExp('^(?:\\t| {1,' + this.opts.tabSize + '})'), '');
          return tab + line;
        });

        const newBlock = changed.join('\n');
        const newText = value.slice(0, lineStart) + newBlock + value.slice(lineEnd);
        this.applyState(
          { text: newText, start: lineStart, end: lineStart + newBlock.length },
          { forceRecord: true }
        );
        return;
      }

      if (e.shiftKey) {
        // Dedent the current line.
        const lineStart = value.lastIndexOf('\n', s - 1) + 1;
        const line = value.slice(lineStart);
        const m = line.match(new RegExp('^(?:\\t| {1,' + this.opts.tabSize + '})'));
        if (m) {
          const removed = m[0].length;
          const newText = value.slice(0, lineStart) + line.slice(removed);
          this.applyState(
            {
              text: newText,
              start: Math.max(lineStart, s - removed),
              end: Math.max(lineStart, en - removed),
            },
            { forceRecord: true }
          );
        }
        return;
      }

      // Plain insert (replaces the selection).
      const newText = value.slice(0, s) + tab + value.slice(en);
      this.applyState({ text: newText, start: s + tab.length, end: s + tab.length }, { forceRecord: true });
    }

    /* ---------- Enter: continue lists / blockquotes ---------- */

    isInsideFence(pos) {
      const upto = this.textarea.value.slice(0, pos);
      const fenceRe = /^ {0,3}(`{3,}|~{3,})/gm;
      let count = 0;
      let m;
      while ((m = fenceRe.exec(upto))) count++;
      return count % 2 === 1;
    }

    handleEnter(e) {
      const ta = this.textarea;
      const { value, selectionStart: s, selectionEnd: en } = ta;
      if (s !== en) return; // selection replaced by default behavior
      if (this.isInsideFence(s)) return; // raw newline inside code fences

      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const before = value.slice(lineStart, s);

      const m = before.match(
        /^(\s*)(?:([-*+])([ \t]+)(\[[ xX][ \t]+)?|(\d+)([.)])([ \t]+)|((?:>[ \t]*)+))?/
      );
      if (!m) return;

      const indent = m[1] || '';
      let prefixLen = 0;
      let nextPrefix = '';

      if (m[2]) {
        // bullet list (with optional task checkbox)
        const marker = m[2];
        const space = m[3];
        const task = m[4] || '';
        prefixLen = indent.length + marker.length + space.length + task.length;
        nextPrefix = indent + marker + space + (task ? task.replace(/x/i, ' ') : '');
      } else if (m[5]) {
        // ordered list — increment the number
        const num = m[5];
        const dot = m[6];
        const space = m[7];
        prefixLen = indent.length + num.length + dot.length + space.length;
        nextPrefix = indent + (parseInt(num, 10) + 1) + dot + space;
      } else if (m[8]) {
        // blockquote (possibly nested)
        const quote = m[8];
        prefixLen = indent.length + quote.length;
        nextPrefix = indent + quote;
      } else {
        return; // nothing to continue
      }

      const content = before.slice(m[0].length);
      const hasContent = content.length > 0;

      e.preventDefault();

      if (!hasContent) {
        // Empty item — pressing Enter removes the marker and exits the list.
        const newText = value.slice(0, lineStart) + value.slice(lineStart + prefixLen);
        this.applyState({ text: newText, start: lineStart, end: lineStart }, { forceRecord: true });
        return;
      }

      const insert = '\n' + nextPrefix;
      const newText = value.slice(0, s) + insert + value.slice(s);
      const caret = s + insert.length;
      this.applyState({ text: newText, start: caret, end: caret }, { forceRecord: true });
    }

    /* ---------- Value & selection ---------- */

    getValue() {
      return this.textarea.value;
    }

    getSelection() {
      return { start: this.textarea.selectionStart, end: this.textarea.selectionEnd };
    }

    setSelection(start, end, opts) {
      const o = opts || {};
      this.textarea.focus({ preventScroll: true });
      this.textarea.setSelectionRange(start, end == null ? start : end);
      this.updateActiveLine();
      if (o.scroll) this.scrollToPos(start);
      this.emit('selection', this.getCursor());
    }

    /** Replace the whole content (document switch / import). Resets history. */
    setValue(text) {
      this.textarea.value = text;
      this.resetHistory();
      // Fresh document view: caret at the very top, both panes scrolled home.
      this.textarea.setSelectionRange(0, 0);
      this.render();
      this.pane.scrollTop = 0;
      this.emit('change', { source: 'set' });
      this.updateActiveLine();
      this.emit('selection', this.getCursor());
    }

    /**
     * Apply a new editor state produced by a transform (toolbar, find
     * & replace, smart keys). Records an undo entry by default.
     */
    applyState(state, opts) {
      const o = opts || {};
      this.applying = true;
      this.textarea.value = state.text;
      this.textarea.focus({ preventScroll: true });
      this.textarea.setSelectionRange(state.start, state.end == null ? state.start : state.end);
      this.applying = false;
      if (o.forceRecord) this.forceRecord();
      else if (o.record !== false) this.record();
      this.render();
      this.updateActiveLine();
      this.emit('change', { source: 'apply' });
    }

    focus() {
      this.textarea.focus({ preventScroll: true });
    }

    getCursor() {
      const pos = this.textarea.selectionStart;
      const before = this.textarea.value.slice(0, pos);
      const line = before.split('\n').length;
      const col = pos - (before.lastIndexOf('\n') + 1) + 1;
      return { line, col, pos };
    }

    /* ---------- Undo / redo ---------- */

    snapshot() {
      return {
        text: this.textarea.value,
        start: this.textarea.selectionStart,
        end: this.textarea.selectionEnd,
      };
    }

    resetHistory() {
      this.history.stack = [this.snapshot()];
      this.history.index = 0;
      this.history.lastPush = 0;
      this.emit('history');
    }

    record() {
      if (this.applying) return;
      const h = this.history;
      const now = Date.now();
      const state = this.snapshot();
      const atTop = h.index === h.stack.length - 1;
      const mergeable =
        atTop && h.stack.length > 0 && now - h.lastPush < MERGE_WINDOW_MS;

      if (mergeable) {
        h.stack[h.index] = state; // coalesce a typing burst into one entry
      } else {
        h.stack.length = h.index + 1; // discard redo tail
        h.stack.push(state);
        if (h.stack.length > HISTORY_LIMIT) {
          h.stack.splice(0, h.stack.length - HISTORY_LIMIT);
        }
        h.index = h.stack.length - 1;
      }
      h.lastPush = now;
      this.emit('history');
    }

    forceRecord() {
      this.history.lastPush = 0;
      this.record();
    }

    canUndo() {
      return this.history.index > 0;
    }

    canRedo() {
      return this.history.index < this.history.stack.length - 1;
    }

    undo() {
      const h = this.history;
      if (!this.canUndo()) return;
      h.index--;
      this.applySnapshot(h.stack[h.index]);
      this.emit('history');
    }

    redo() {
      const h = this.history;
      if (!this.canRedo()) return;
      h.index++;
      this.applySnapshot(h.stack[h.index]);
      this.emit('history');
    }

    applySnapshot(snap) {
      this.applying = true;
      this.textarea.value = snap.text;
      this.textarea.focus({ preventScroll: true });
      this.textarea.setSelectionRange(snap.start, snap.end);
      this.applying = false;
      this.render();
      this.updateActiveLine();
      this.scrollToPos(snap.start, 'auto');
      this.emit('change', { source: 'history' });
      this.emit('selection', this.getCursor());
    }

    /* ---------- Rendering the mirror ---------- */

    scheduleRender() {
      if (this._renderQueued) return;
      this._renderQueued = true;
      requestAnimationFrame(() => {
        this._renderQueued = false;
        this.render();
      });
    }

    /** Recompute find matches against the current text (keeps panel in sync). */
    refreshFind() {
      const s = this.findState;
      if (!s.query) return;
      s.matches = this.computeMatches();
      if (s.matches.length) {
        if (s.current < 0 || s.current >= s.matches.length) s.current = 0;
      } else {
        s.current = -1;
      }
    }

    render() {
      this.refreshFind();
      const text = this.textarea.value;
      let lineHtmls;

      const canHighlight =
        typeof hljs !== 'undefined' &&
        typeof hljs.getLanguage === 'function' &&
        hljs.getLanguage('markdown') &&
        text.length <= MAX_HIGHLIGHT_CHARS;

      try {
        if (canHighlight) {
          const highlighted = hljs.highlight(text, {
            language: 'markdown',
            ignoreIllegals: true,
          }).value;
          lineHtmls = this.splitHighlightedLines(highlighted);
        } else {
          lineHtmls = Utils.escapeHtml(text).split('\n');
        }
      } catch (err) {
        console.warn('Highlighting failed, falling back to plain rendering:', err);
        lineHtmls = Utils.escapeHtml(text).split('\n');
      }

      const mirror = this.mirror;
      mirror.textContent = '';
      const frag = document.createDocumentFragment();

      for (let i = 0; i < lineHtmls.length; i++) {
        const el = document.createElement('div');
        el.className = 'line';
        el.dataset.n = String(i + 1);
        let html = lineHtmls[i];
        if (!html || html.replace(/<[^>]*>/g, '') === '') html = '\u200b';
        el.innerHTML = html;
        frag.append(el);
      }

      mirror.append(frag);
      this.lineEls = Array.prototype.slice.call(mirror.children);
      this.applyFindMarks();
      this.updateActiveLine();
    }

    /**
     * Split highlighted HTML (whose spans may cross newlines) into
     * per-line fragments that are individually balanced: spans still
     * open at a line end are closed and re-opened on the next line.
     */
    splitHighlightedLines(html) {
      const parts = html.split('\n');
      const open = [];
      const out = [];

      for (const part of parts) {
        const prefix = open.join('');
        const stack = open.slice();
        const tagRe = /<(\/?)span[^>]*>/g;
        let m;
        while ((m = tagRe.exec(part))) {
          if (m[1]) stack.pop();
          else stack.push(m[0]);
        }
        out.push(prefix + part + '</span>'.repeat(stack.length));
        open.length = 0;
        for (const t of stack) open.push(t);
      }
      return out;
    }

    updateActiveLine() {
      const lineIndex = this.valueLineAt(this.textarea.selectionStart);
      if (lineIndex === this.activeLineIndex) return;
      if (this.lineEls[this.activeLineIndex]) {
        this.lineEls[this.activeLineIndex].classList.remove('active');
      }
      this.activeLineIndex = lineIndex;
      if (this.lineEls[lineIndex]) this.lineEls[lineIndex].classList.add('active');
    }

    valueLineAt(pos) {
      let line = 0;
      const text = this.textarea.value;
      for (let i = 0; i < pos && i < text.length; i++) {
        if (text[i] === '\n') line++;
      }
      return line;
    }

    scrollToPos(pos, behavior) {
      const lineIndex = this.valueLineAt(pos);
      const el = this.lineEls[lineIndex];
      if (!el) return;
      const target = Math.max(0, el.offsetTop - this.pane.clientHeight / 3);
      this.pane.scrollTo({ top: target, behavior: behavior || 'smooth' });
    }

    /* ---------- Find & replace ---------- */

    setOptions(patch) {
      Object.assign(this.opts, patch);
      if ('lineNumbers' in patch) {
        this.surface.classList.toggle('no-line-numbers', !patch.lineNumbers);
      }
      if ('tabSize' in patch) {
        this.surface.style.setProperty('--editor-tab-size', patch.tabSize);
      }
    }

    setFind(patch) {
      const state = this.findState;
      if ('query' in patch) state.query = patch.query;
      if ('caseSensitive' in patch) state.caseSensitive = patch.caseSensitive;
      state.matches = this.computeMatches();
      if (state.matches.length) {
        if (state.current < 0 || state.current >= state.matches.length) state.current = 0;
      } else {
        state.current = -1;
      }
      this.render();
      return { count: state.matches.length, current: state.current };
    }

    findStateInfo() {
      const s = this.findState;
      return { count: s.matches.length, current: s.current };
    }

    computeMatches() {
      const { query, caseSensitive } = this.findState;
      if (!query || query.indexOf('\n') !== -1) return [];
      const text = this.textarea.value;
      const hay = caseSensitive ? text : text.toLowerCase();
      const needle = caseSensitive ? query : query.toLowerCase();
      const matches = [];
      let idx = 0;
      while ((idx = hay.indexOf(needle, idx)) !== -1) {
        matches.push({ start: idx, end: idx + needle.length });
        idx += needle.length;
        if (matches.length >= MAX_FIND_MATCHES) break;
      }
      return matches;
    }

    /** Highlight all matches with <mark> elements inside the mirror. */
    applyFindMarks() {
      const { query, caseSensitive, matches, current } = this.findState;
      if (!query || !matches.length) return;

      const srcLines = this.textarea.value.split('\n');
      let offset = 0; // character offset of the current line start

      for (let i = 0; i < this.lineEls.length && i < srcLines.length; i++) {
        const src = srcLines[i];
        if (src) this.markLine(this.lineEls[i], matches, offset, current);
        offset += src.length + 1;
      }
    }

    markLine(lineEl, matches, lineStart, current) {
      const nodes = [];
      this.collectTextNodes(lineEl, nodes);
      let local = 0;

      for (const node of nodes) {
        const text = node.nodeValue;
        if (!text) continue;
        const nodeStart = lineStart + local;
        const nodeEnd = nodeStart + text.length;
        local += text.length;

        const clips = [];
        for (let mi = 0; mi < matches.length; mi++) {
          const mt = matches[mi];
          if (mt.end <= nodeStart) continue;
          if (mt.start >= nodeEnd) break;
          clips.push({
            s: Math.max(mt.start, nodeStart) - nodeStart,
            e: Math.min(mt.end, nodeEnd) - nodeStart,
            mi,
          });
        }
        if (!clips.length) continue;

        const frag = document.createDocumentFragment();
        let pos = 0;
        for (const clip of clips) {
          if (clip.s > pos) frag.append(document.createTextNode(text.slice(pos, clip.s)));
          const mark = document.createElement('mark');
          mark.className = 'find-hit' + (clip.mi === current ? ' current' : '');
          mark.textContent = text.slice(clip.s, clip.e);
          frag.append(mark);
          pos = clip.e;
        }
        if (pos < text.length) frag.append(document.createTextNode(text.slice(pos)));
        node.replaceWith(frag);
      }
    }

    collectTextNodes(root, out) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      let n;
      while ((n = walker.nextNode())) out.push(n);
    }

    /** Move to the next/previous match. Returns match info or null. */
    jumpMatch(direction) {
      const s = this.findState;
      if (!s.matches.length) return null;
      if (s.current === -1) s.current = 0;
      else if (direction === 'prev') s.current = (s.current - 1 + s.matches.length) % s.matches.length;
      else s.current = (s.current + 1) % s.matches.length;

      const match = s.matches[s.current];
      this.render(); // repaint marks with the new "current"
      this.setSelection(match.start, match.end, { scroll: true });
      return { index: s.current, count: s.matches.length, match };
    }

    /** Replace the current match with `replacement`. */
    replaceCurrent(replacement) {
      const s = this.findState;
      if (!s.matches.length || s.current < 0) return false;
      const m = s.matches[s.current];
      const text = this.textarea.value;
      const newText = text.slice(0, m.start) + replacement + text.slice(m.end);
      const caret = m.start + replacement.length;
      this.applyState({ text: newText, start: caret, end: caret }, { forceRecord: true });
      // applyState → render → matches recomputed; the same index now points
      // at the match that follows the replaced one.
      if (s.matches.length) {
        if (s.current >= s.matches.length) s.current = 0;
        const next = s.matches[s.current];
        if (next) this.setSelection(next.start, next.end, { scroll: true });
      }
      return true;
    }

    /** Replace every match. Returns the number of replacements. */
    replaceAll(replacement) {
      const s = this.findState;
      if (!s.matches.length) return 0;
      const text = this.textarea.value;
      const count = s.matches.length;

      let out = '';
      let pos = 0;
      for (const m of s.matches) {
        out += text.slice(pos, m.start) + replacement;
        pos = m.end;
      }
      out += text.slice(pos);

      const caret = Math.min(out.length, s.matches[0].start + replacement.length);
      this.applyState({ text: out, start: caret, end: caret }, { forceRecord: true });
      return count;
    }

    clearFind() {
      this.findState.query = '';
      this.findState.matches = [];
      this.findState.current = -1;
      this.render();
    }

    /* ---------- Tiny event bus ---------- */

    on(event, cb) {
      (this.listeners[event] = this.listeners[event] || []).push(cb);
      return this;
    }

    emit(event, data) {
      const cbs = this.listeners[event];
      if (!cbs) return;
      for (const cb of cbs) cb(data);
    }
  }

  window.Editor = Editor;
})();
