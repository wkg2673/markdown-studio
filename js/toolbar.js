/* ============================================================
   Markdown Studio — toolbar.js
   Formatting toolbar: pure text transforms (value + selection in →
   value + selection out) plus DOM wiring for the toolbar buttons.
   ============================================================ */

'use strict';

(function () {
  /**
   * All transforms receive { text, start, end } (the editor state)
   * and return a new { text, start, end }.
   */
  const Actions = {
    bold(state) {
      return wrap(state, '**', '**', 'bold text');
    },

    italic(state) {
      return wrap(state, '*', '*', 'italic text');
    },

    strikethrough(state) {
      return wrap(state, '~~', '~~', 'struck text');
    },

    code(state) {
      return wrap(state, '`', '`', 'code');
    },

    quote(state) {
      return toggleLine(state, 'quote');
    },

    ul(state) {
      return toggleLine(state, 'ul');
    },

    ol(state) {
      return toggleLine(state, 'ol');
    },

    task(state) {
      return toggleLine(state, 'task');
    },

    heading(state, level) {
      return setHeading(state, level);
    },

    link(state) {
      const { text, start, end } = state;
      const sel = text.slice(start, end);
      const label = sel || 'link text';
      const insert = '[' + label + '](https://)';
      const newText = text.slice(0, start) + insert + text.slice(end);
      // Select the URL so it can be typed over immediately.
      const urlStart = start + label.length + 3;
      return { text: newText, start: urlStart, end: urlStart + 8 };
    },

    image(state) {
      const { text, start, end } = state;
      const sel = text.slice(start, end);
      const label = sel || 'alt text';
      const insert = '![' + label + '](https://example.com/image.png)';
      const newText = text.slice(0, start) + insert + text.slice(end);
      const urlStart = start + label.length + 4;
      return { text: newText, start: urlStart, end: urlStart + 26 };
    },

    codeblock(state) {
      const { text, start, end } = state;
      const sel = text.slice(start, end);
      const body = sel || 'code';
      const block = '```\n' + body + '\n```';
      const result = insertBlock(state, block);
      // Select the body (or placeholder) inside the fence.
      const offset = result.start - block.length + 4; // after "```\n"
      return { text: result.text, start: offset, end: offset + body.length };
    },

    table(state) {
      const block = [
        '| Column 1 | Column 2 | Column 3 |',
        '| -------- | -------- | -------- |',
        '| Cell     | Cell     | Cell     |',
        '| Cell     | Cell     | Cell     |',
      ].join('\n');
      return insertBlock(state, block);
    },

    hr(state) {
      return insertBlock(state, '---');
    },
  };

  /* ---------- Inline transforms ---------- */

  /**
   * Wrap (or unwrap) the selection with markers. When the selection is
   * empty, a placeholder is inserted and selected so typing replaces it.
   */
  function wrap(state, before, after, placeholder) {
    const { text, start, end } = state;
    const sel = text.slice(start, end);

    // Toggle off when the selection is already wrapped.
    if (
      sel.length >= before.length + after.length &&
      sel.startsWith(before) &&
      sel.endsWith(after)
    ) {
      const inner = sel.slice(before.length, sel.length - after.length);
      return {
        text: text.slice(0, start) + inner + text.slice(end),
        start,
        end: start + inner.length,
      };
    }

    // Toggle off when the caret sits right between the markers, or the
    // selection covers exactly the wrapped content (the state the wrap
    // action itself leaves behind).
    const beforeCtx = text.slice(Math.max(0, start - before.length), start);
    const afterCtx = text.slice(end, end + after.length);
    if (beforeCtx === before && afterCtx === after) {
      const cutStart = start - before.length;
      const cutEnd = end + after.length;
      return {
        text: text.slice(0, cutStart) + sel + text.slice(cutEnd),
        start: cutStart,
        end: cutStart + sel.length,
      };
    }

    const insert = sel.length ? sel : placeholder;
    const newText = text.slice(0, start) + before + insert + after + text.slice(end);
    return {
      text: newText,
      start: start + before.length,
      end: start + before.length + insert.length,
    };
  }

  /* ---------- Line transforms (lists, quotes) ---------- */

  /**
   * Parse one line into markdown block-structure parts:
   *   ws     leading whitespace (indentation)
   *   quote  "> " prefix (possibly nested, e.g. "> > ")
   *   marker "- " / "* " / "+ " / "1. " / "1) "
   *   task   "[ ] " or "[x] " (only valid after a bullet marker)
   *   content  the rest
   */
  function parseLine(line) {
    const wsMatch = line.match(/^(\s*)/);
    const ws = wsMatch ? wsMatch[1] : '';
    let rest = line.slice(ws.length);

    let quote = '';
    const quoteMatch = rest.match(/^((?:>[ \t]*)+)/);
    if (quoteMatch) {
      quote = quoteMatch[1];
      rest = rest.slice(quote.length);
    }

    let marker = '';
    let isOrdered = false;
    const bulletMatch = rest.match(/^([-*+])[ \t]+/);
    const orderedMatch = rest.match(/^(\d+[.)])[ \t]+/);
    if (bulletMatch) {
      marker = bulletMatch[0];
    } else if (orderedMatch) {
      marker = orderedMatch[0];
      isOrdered = true;
    }

    let task = '';
    let after = rest.slice(marker.length);
    const taskMatch = after.match(/^\[[ xX][ \t]+/);
    if (taskMatch) {
      task = taskMatch[0];
      after = after.slice(task.length);
    }

    return { ws, quote, marker, task, content: after, isOrdered };
  }

  const hasTarget = {
    ul: (p) => !!p.marker && !p.isOrdered,
    ol: (p) => p.isOrdered,
    task: (p) => !!p.task,
    quote: (p) => !!p.quote,
  };

  /**
   * Toggle a block structure (bullet / ordered / task list, quote)
   * on every selected line. When every line already has it, it is
   * removed; otherwise it is added (converting between list kinds).
   */
  function toggleLine(state, kind) {
    const { text, start, end } = state;

    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    let nl = text.indexOf('\n', end);
    const lineEnd = nl === -1 ? text.length : nl;
    const block = text.slice(lineStart, lineEnd);
    const lines = block.split('\n');
    const parsed = lines.map(parseLine);

    const allHave = parsed.every(hasTarget[kind]);
    let counter = 0;

    const newLines = parsed.map((p) => {
      if (allHave) {
        // Remove the target structure.
        if (kind === 'ul') return p.ws + p.quote + p.content;
        if (kind === 'ol') return p.ws + p.quote + p.content;
        if (kind === 'task') return p.ws + p.quote + p.marker + p.content;
        if (kind === 'quote') return p.ws + p.marker + p.task + p.content;
      }

      // Add / convert the structure.
      if (hasTarget[kind](p)) {
        return p.ws + p.quote + p.marker + p.task + p.content; // already has it
      }
      if (kind === 'ul') {
        return p.ws + p.quote + '- ' + p.task + p.content;
      }
      if (kind === 'ol') {
        counter += 1;
        return p.ws + p.quote + counter + '. ' + p.task + p.content;
      }
      if (kind === 'task') {
        if (p.marker && !p.isOrdered) return p.ws + p.quote + p.marker + '[ ] ' + p.content;
        return p.ws + p.quote + '- [ ] ' + p.content;
      }
      if (kind === 'quote') {
        return p.ws + '> ' + p.marker + p.task + p.content;
      }
      return p.ws + p.quote + p.marker + p.task + p.content;
    });

    const newBlock = newLines.join('\n');
    const newText = text.slice(0, lineStart) + newBlock + text.slice(lineEnd);
    const delta = newBlock.length - block.length;

    return { text: newText, start, end: Math.max(start, end + delta) };
  }

  /* ---------- Block transforms ---------- */

  /** Set (or remove, when identical) a heading level on the current line. */
  function setHeading(state, level) {
    const { text, start, end } = state;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    let nl = text.indexOf('\n', end);
    const lineEnd = nl === -1 ? text.length : nl;
    const line = text.slice(lineStart, lineEnd);

    const m = line.match(/^(#{1,6})\s+/);
    const existing = m ? m[1].length : 0;
    const rest = m ? line.slice(m[0].length) : line;

    let newLine;
    if (existing === level) {
      newLine = rest; // same level — toggle off
    } else {
      newLine = '#'.repeat(level) + ' ' + rest;
    }

    const newText = text.slice(0, lineStart) + newLine + text.slice(lineEnd);
    const delta = newLine.length - line.length;
    return {
      text: newText,
      start: Math.min(start + delta, lineStart + newLine.length),
      end: Math.min(end + delta, lineStart + newLine.length),
    };
  }

  /** Insert a block (hr / table / fence) with separating blank lines. */
  function insertBlock(state, blockText) {
    const { text, start, end } = state;
    const before = text.slice(0, start);
    const after = text.slice(end);

    let pre = '';
    if (before.length) {
      if (!before.endsWith('\n')) pre = '\n\n';
      else if (!before.endsWith('\n\n') && before.trim().length) pre = '\n';
    }

    let post = '';
    if (after.length) {
      if (!after.startsWith('\n')) post = '\n\n';
      else if (!after.startsWith('\n\n') && after.trim().length) post = '\n';
    }

    const newText = before + pre + blockText + post + after;
    const caret = before.length + pre.length + blockText.length;
    return { text: newText, start: caret, end: caret };
  }

  /* ---------- DOM wiring ---------- */

  /**
   * Wire every toolbar button to the editor. Called once from app.js
   * after the editor instance exists.
   */
  function initToolbar(editor) {
    $$('#toolbar [data-cmd]').forEach((btn) => {
      btn.addEventListener('click', () => {
        runCommand(editor, btn.getAttribute('data-cmd'));
      });
    });
    return { runCommand: (cmd, arg) => runCommand(editor, cmd, arg) };
  }

  function runCommand(editor, cmd, arg) {
    const action = Actions[cmd];
    if (!action) return;
    const sel = editor.getSelection();
    const state = {
      text: editor.getValue(),
      start: sel.start,
      end: sel.end,
    };
    editor.applyState(action(state, arg), { forceRecord: true });
    editor.focus();
  }

  window.Toolbar = { Actions, initToolbar };
})();
