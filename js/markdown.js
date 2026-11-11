/* ============================================================
   Markdown Studio — markdown.js
   Markdown → sanitized HTML pipeline.

   - marked (GFM: tables, task lists, strikethrough, autolinks)
   - highlight.js for fenced code blocks
   - DOMPurify for output sanitization
   - Footnote support via a small pre/post-processing pass
   - Graceful fallback renderer if a library fails to load
   ============================================================ */

'use strict';

(function () {
  let configured = false;

  /* ---------- Footnotes ---------- */

  function footnoteSlug(label) {
    const slug = String(label).replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '');
    return slug || 'fn';
  }

  /**
   * Pull `[^label]: text` definitions out of the source so marked does
   * not render them as plain text. Continuation lines (indented) are
   * merged into the definition. Returns the cleaned body plus defs.
   */
  function extractFootnotes(src) {
    const lines = src.split('\n');
    const defs = new Map();
    const out = [];

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^ {0,3}\[\^([^\]\s]+)\]:\s*(.*)$/);
      if (!m) {
        out.push(lines[i]);
        continue;
      }
      const label = m[1];
      const entry = defs.get(label) || { label, parts: [] };
      if (m[2].trim()) entry.parts.push(m[2]);

      // Absorb indented continuation lines that follow the definition.
      let j = i + 1;
      while (j < lines.length && lines[j].trim() && /^(?: {4,}|\t)/.test(lines[j])) {
        entry.parts.push(lines[j].trim());
        j++;
      }
      defs.set(label, entry);
      i = j - 1;
    }

    const footnotes = Array.from(defs.values()).map((f) => ({
      label: f.label,
      text: f.parts.join(' '),
    }));

    return { body: out.join('\n'), footnotes };
  }

  /**
   * Replace `[^label]` references with superscript anchors and
   * number them in order of first appearance.
   */
  function replaceFootnoteRefs(body, footnotes) {
    const defined = new Set(footnotes.map((f) => f.label));
    const order = [];

    return body.replace(/\[\^([^\]\s]+)\]/g, (whole, label, offset, full) => {
      if (full[offset - 1] === '\\') return whole; // escaped — leave for marked
      let index = order.indexOf(label);
      if (index === -1) {
        order.push(label);
        index = order.length - 1;
      }
      const slug = footnoteSlug(label);
      if (!defined.has(label)) {
        // Reference without definition: render literally, no link.
        return '<sup class="footnote-ref missing" aria-label="Unresolved footnote">[' +
          Utils.escapeHtml(label) + ']</sup>';
      }
      return (
        '<sup class="footnote-ref" id="fnref-' + slug + '">' +
        '<a href="#fn-' + slug + '" aria-label="Jump to footnote ' + (index + 1) + '">' +
        (index + 1) +
        '</a></sup>'
      );
    });
  }

  /** Build the footnotes section appended after the rendered body. */
  function buildFootnotesSection(footnotes, order) {
    const referenced = order.filter((label) => footnotes.some((f) => f.label === label));
    const unreferenced = footnotes
      .map((f) => f.label)
      .filter((label) => referenced.indexOf(label) === -1);
    const orderedLabels = referenced.concat(unreferenced);

    const items = orderedLabels.map((label) => {
      const def = footnotes.find((f) => f.label === label);
      const slug = footnoteSlug(label);
      let rendered = '';
      try {
        rendered = marked.parseInline(def.text || '');
      } catch (err) {
        rendered = Utils.escapeHtml(def.text || '');
      }
      return (
        '<li id="fn-' + slug + '">' + rendered +
        ' <a href="#fnref-' + slug + '" class="footnote-backref" aria-label="Back to reference">↩︎</a></li>'
      );
    });

    if (!items.length) return '';
    return (
      '<section class="footnotes" aria-label="Footnotes"><hr>' +
      '<ol>' + items.join('') + '</ol></section>'
    );
  }

  /* ---------- Code block rendering with highlight.js ---------- */

  function highlightCode(code, lang) {
    if (typeof hljs === 'undefined') return { html: Utils.escapeHtml(code), lang };
    try {
      if (lang && hljs.getLanguage(lang)) {
        return { html: hljs.highlight(code, { language: lang, ignoreIllegals: true }).value, lang };
      }
      const auto = hljs.highlightAuto(code);
      return { html: auto.value, lang: auto.language || lang };
    } catch (err) {
      return { html: Utils.escapeHtml(code), lang };
    }
  }

  function configure() {
    if (configured || typeof marked === 'undefined') return;
    configured = true;

    marked.use({
      gfm: true,
      breaks: true,
      renderer: {
        code(code, infostring) {
          const lang = (infostring || '').trim().split(/\s+/)[0].toLowerCase();
          const { html, lang: detected } = highlightCode(code, lang);
          const label = (detected || '').toLowerCase();
          const copyIcon =
            '<button type="button" class="code-copy-btn" data-copy-code ' +
            'aria-label="Copy code to clipboard" title="Copy code">' +
            (typeof icon === 'function'
              ? icon('clipboard')
              : '<span style="font-size:11px">Copy</span>') +
            '</button>';
          return (
            '<div class="code-block">' +
            (label ? '<span class="code-lang-badge">' + Utils.escapeHtml(label) + '</span>' : '') +
            '<pre><code class="hljs">' + html + '</code></pre>' +
            copyIcon +
            '</div>'
          );
        },
        link(href, title, text) {
          const cleanHref = typeof href === 'string' ? href : '';
          const isExternal = /^https?:\/\//i.test(cleanHref);
          const attrs = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
          const titleAttr = title ? ' title="' + Utils.escapeHtml(title) + '"' : '';
          return '<a href="' + Utils.escapeHtml(cleanHref) + '"' + titleAttr + attrs + '>' + text + '</a>';
        },
      },
    });
  }

  /* ---------- Fallback renderer (used only if marked failed to load) ---------- */

  function fallbackRender(src) {
    const escape = Utils.escapeHtml;
    const blocks = src.split(/\n{2,}/);
    const html = blocks
      .map((block) => {
        const trimmed = block.trim();
        if (!trimmed) return '';
        if (/^#{1,6}\s/.test(trimmed)) {
          const level = trimmed.match(/^#+/)[0].length;
          return '<h' + level + '>' + escape(trimmed.replace(/^#+\s*/, '')) + '</h' + level + '>';
        }
        if (/^```/.test(trimmed)) return '<pre><code>' + escape(trimmed.replace(/^```\w*\n?|```$/g, '')) + '</code></pre>';
        if (/^>\s?/.test(trimmed)) return '<blockquote>' + escape(trimmed.replace(/^>\s?/gm, '')) + '</blockquote>';
        if (/^(-{3,}|\*{3,})$/.test(trimmed)) return '<hr>';
        return '<p>' + escape(trimmed).replace(/\n/g, '<br>') + '</p>';
      })
      .join('\n');
    return '<div class="fallback-notice" style="opacity:.7;font-size:12px;padding:8px 0">' +
      'Preview is running in fallback mode (a rendering library failed to load).</div>' + html;
  }

  /* ---------- Public API ---------- */

  /**
   * Render Markdown source to sanitized HTML.
   * @param {string} src Markdown text
   * @param {{breaks?: boolean}} [opts] Per-render options
   */
  function render(src, opts) {
    const source = src || '';

    if (typeof marked === 'undefined') return fallbackRender(source);
    configure();

    const options = opts || {};
    marked.setOptions({ breaks: options.breaks !== false });

    const { body, footnotes } = extractFootnotes(source);
    const withRefs = replaceFootnoteRefs(body, footnotes);

    let html;
    try {
      html = marked.parse(withRefs);
    } catch (err) {
      console.error('marked parse error:', err);
      return '<p style="color:var(--danger)">Rendering error: ' + Utils.escapeHtml(err.message) + '</p>';
    }

    // Recompute reference order so the footnotes <ol> numbering matches
    // the numbers assigned to references in the body.
    const order = [];
    const refRe = /\[\^([^\]\s]+)\]/g;
    let m;
    while ((m = refRe.exec(body))) {
      if (body[m.index - 1] === '\\') continue;
      if (defined(footnotes, m[1]) && order.indexOf(m[1]) === -1) order.push(m[1]);
    }
    html += buildFootnotesSection(footnotes, order);

    if (typeof DOMPurify !== 'undefined') {
      return DOMPurify.sanitize(html, {
        ADD_ATTR: ['target', 'rel'],
        FORBID_TAGS: ['style'],
      });
    }
    // Extremely defensive path — should not happen with vendored libs.
    console.warn('DOMPurify missing — returning escaped text only.');
    return Utils.escapeHtml(html);
  }

  function defined(footnotes, label) {
    return footnotes.some((f) => f.label === label);
  }

  /** Render a single line of inline Markdown (used for footnote text). */
  function renderInline(text) {
    if (typeof marked === 'undefined') return Utils.escapeHtml(text);
    configure();
    try {
      return marked.parseInline(text || '');
    } catch (err) {
      return Utils.escapeHtml(text);
    }
  }

  /** True when the full pipeline (marked + DOMPurify) is available. */
  function isReady() {
    return typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined';
  }

  window.Markdown = { render, renderInline, isReady };
})();
