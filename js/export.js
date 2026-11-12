/* ============================================================
   Markdown Studio — export.js

   Two export targets:

   1. Standalone HTML — a self-contained document with embedded
      styles, the rendered (already sanitized) Markdown body, and
      optional inlining of local images so the file works anywhere.

   2. PDF — browsers generate PDFs through their print pipeline, so
      this builds the same standalone document, writes it into a
      hidden iframe, and opens the native print dialog. Choosing
      "Save as PDF" produces a clean, paginated PDF without the
      editor UI.

   Depends on: Utils.escapeHtml / Utils.downloadFile (utils.js).
   ============================================================ */

'use strict';

(function () {
  const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024; // per image
  const MAX_INLINE_TOTAL_BYTES = 8 * 1024 * 1024; // per export

  const escape = (value) =>
    typeof Utils !== 'undefined' && Utils.escapeHtml
      ? Utils.escapeHtml(String(value == null ? '' : value))
      : String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => {
          switch (ch) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            default: return '&#39;';
          }
        });

  /* ---------- Standalone stylesheet ---------- */

  const DOCUMENT_CSS = `
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --surface: #f6f7fa;
  --text: #242a36;
  --strong: #10141d;
  --muted: #5b6472;
  --border: #e3e7ef;
  --accent: #4f7cff;
  --code-bg: #f6f7fa;
  --inline-code: #eef1f7;
  --quote-bg: #f4f7fd;
  --table-head: #f4f6fb;
  --syn-comment: #6a737d;
  --syn-keyword: #a626a4;
  --syn-string: #2f7d32;
  --syn-number: #b76b01;
  --syn-title: #1f5fbf;
  --syn-attr: #b45309;
  --syn-type: #0f766e;
  --syn-tag: #c2410c;
  --syn-variable: #24292f;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16181d;
    --surface: #1b1f27;
    --text: #c9d1df;
    --strong: #f0f3fa;
    --muted: #8b95a7;
    --border: #2a303c;
    --accent: #7aa2ff;
    --code-bg: #13161c;
    --inline-code: #232936;
    --quote-bg: #1b2130;
    --table-head: #1b2130;
    --syn-comment: #7f8a9c;
    --syn-keyword: #e08bff;
    --syn-string: #8bd98d;
    --syn-number: #f0b35c;
    --syn-title: #79b8ff;
    --syn-attr: #f2b880;
    --syn-type: #4dd4c6;
    --syn-tag: #ff9d76;
    --syn-variable: #d7deea;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.7;
}
.markdown-body {
  max-width: 52rem;
  margin: 0 auto;
  padding: 3.5rem 1.5rem 5rem;
  overflow-wrap: break-word;
}
.markdown-body > *:first-child { margin-top: 0; }
.markdown-body h1, .markdown-body h2, .markdown-body h3,
.markdown-body h4, .markdown-body h5, .markdown-body h6 {
  color: var(--strong);
  line-height: 1.3;
  margin: 1.6em 0 0.6em;
  font-weight: 700;
}
.markdown-body h1 { font-size: 2em; padding-bottom: 0.35em; border-bottom: 1px solid var(--border); }
.markdown-body h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid var(--border); }
.markdown-body h3 { font-size: 1.25em; }
.markdown-body h4 { font-size: 1.08em; }
.markdown-body h5 { font-size: 0.95em; }
.markdown-body h6 { font-size: 0.88em; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.markdown-body p { margin: 0.8em 0; }
.markdown-body a { color: var(--accent); text-decoration: none; border-bottom: 1px solid transparent; }
.markdown-body a:hover { border-bottom-color: currentColor; }
.markdown-body strong { color: var(--strong); font-weight: 700; }
.markdown-body em { font-style: italic; }
.markdown-body del { color: var(--muted); }
.markdown-body ul, .markdown-body ol { margin: 0.8em 0; padding-left: 1.7em; }
.markdown-body li { margin: 0.28em 0; }
.markdown-body li > ul, .markdown-body li > ol { margin: 0.25em 0; }
.markdown-body input[type="checkbox"] {
  accent-color: var(--accent);
  width: 15px; height: 15px;
  margin: 0 0.45em 0 -1.6em;
  vertical-align: -2px;
}
.markdown-body li:has(> input[type="checkbox"]) { list-style: none; }
.markdown-body blockquote {
  margin: 1em 0;
  padding: 0.6em 1.1em;
  border-left: 3px solid var(--accent);
  border-radius: 0 8px 8px 0;
  background: var(--quote-bg);
  color: var(--muted);
}
.markdown-body blockquote p { margin: 0.3em 0; }
.markdown-body hr {
  border: none;
  height: 1px;
  margin: 2em 0;
  background: var(--border);
}
.markdown-body code {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 0.86em;
  background: var(--inline-code);
  border-radius: 5px;
  padding: 0.15em 0.4em;
}
.markdown-body .code-block { position: relative; margin: 1.1em 0; }
.markdown-body .code-block pre {
  margin: 0;
  padding: 14px 16px 14px 18px;
  overflow-x: auto;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--code-bg);
  line-height: 1.6;
}
.markdown-body .code-block code {
  display: block;
  background: none;
  padding: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--syn-variable);
}
.markdown-body .code-lang-badge {
  position: absolute;
  top: 0; right: 0;
  padding: 3px 10px;
  border-radius: 0 0 6px 6px;
  background: var(--surface);
  color: var(--muted);
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  pointer-events: none;
}
.markdown-body table {
  width: 100%;
  margin: 1.2em 0;
  border-collapse: collapse;
  font-size: 0.94em;
}
.markdown-body thead { background: var(--table-head); }
.markdown-body th, .markdown-body td {
  border: 1px solid var(--border);
  padding: 0.55em 0.8em;
  text-align: left;
  vertical-align: top;
}
.markdown-body th { color: var(--strong); font-weight: 700; }
.markdown-body img { max-width: 100%; height: auto; border-radius: 6px; }
.markdown-body sup.footnote-ref { font-size: 0.75em; }
.markdown-body .footnotes {
  margin-top: 2.5em;
  font-size: 0.92em;
  color: var(--muted);
}
.markdown-body .footnotes hr { margin-bottom: 1em; }
.markdown-body .footnotes ol { padding-left: 1.4em; }
.markdown-body .footnote-backref { margin-left: 0.25em; text-decoration: none; }
.hljs-comment, .hljs-quote { color: var(--syn-comment); font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-subst { color: var(--syn-keyword); }
.hljs-number, .hljs-literal { color: var(--syn-number); }
.hljs-string, .hljs-doctag, .hljs-regexp, .hljs-addition { color: var(--syn-string); }
.hljs-title, .hljs-section, .hljs-name { color: var(--syn-title); }
.hljs-title.function_, .hljs-built_in, .hljs-class .hljs-title { color: var(--syn-title); }
.hljs-attr, .hljs-attribute, .hljs-selector-attr { color: var(--syn-attr); }
.hljs-type, .hljs-selector-class, .hljs-selector-id { color: var(--syn-type); }
.hljs-tag { color: var(--syn-tag); }
.hljs-tag .hljs-name { color: var(--syn-tag); }
.hljs-variable, .hljs-template-variable, .hljs-property { color: var(--syn-variable); }
.hljs-symbol, .hljs-bullet { color: var(--syn-attr); }
.hljs-deletion { color: #c0392b; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: 700; }
.doc-footer { display: none; }

@page { size: A4; margin: 16mm 14mm; }

@media print {
  :root {
    --bg: #ffffff;
    --surface: #f5f5f5;
    --text: #1b1b1b;
    --strong: #000000;
    --muted: #444444;
    --border: #cccccc;
    --accent: #000000;
    --code-bg: #f5f5f5;
    --inline-code: #eeeeee;
    --quote-bg: #f5f5f5;
    --table-head: #f0f0f0;
    --syn-comment: #666666;
    --syn-keyword: #7b2d8e;
    --syn-string: #1f6f2b;
    --syn-number: #8a4b00;
    --syn-title: #1a4f9c;
    --syn-attr: #8a4b00;
    --syn-type: #0f6b63;
    --syn-tag: #a33d0a;
    --syn-variable: #222222;
  }
  html, body { background: #ffffff; }
  body { font-size: 11.5pt; }
  .markdown-body { max-width: none; padding: 0; }
  .markdown-body a { color: inherit; text-decoration: underline; }
  .markdown-body a[href^="http"]::after {
    content: " (" attr(href) ")";
    font-size: 0.82em;
    color: #555555;
    word-break: break-all;
  }
  .markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4 {
    page-break-after: avoid;
    break-after: avoid;
  }
  .markdown-body pre, .markdown-body blockquote, .markdown-body table,
  .markdown-body img, .markdown-body li { page-break-inside: avoid; break-inside: avoid; }
  .markdown-body .code-block pre { white-space: pre-wrap; overflow-wrap: anywhere; }
  .markdown-body .code-lang-badge {
    position: static;
    display: inline-block;
    background: none;
    color: #666666;
    padding: 0 0 4px;
  }
  .doc-footer {
    display: block;
    margin-top: 28px;
    padding-top: 10px;
    border-top: 1px solid #cccccc;
    font-size: 10pt;
    color: #666666;
  }
}
`;

  /* ---------- Body preparation ---------- */

  function parseBody(html) {
    const doc = new DOMParser().parseFromString(
      '<div id="__export-root">' + (html || '') + '</div>',
      'text/html'
    );
    return doc;
  }

  function serializeBody(doc) {
    const root = doc.getElementById('__export-root');
    return root ? root.innerHTML : '';
  }

  function readAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error('Could not read image'));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Remove editor-only artifacts (code copy buttons) and, when asked,
   * inline same-origin images so the exported file is portable.
   */
  async function cleanBody(html, opts) {
    const options = opts || {};
    const doc = parseBody(html);

    doc.querySelectorAll('[data-copy-code]').forEach((node) => node.remove());

    if (options.inlineImages && typeof fetch === 'function') {
      let total = 0;
      const images = Array.prototype.slice.call(doc.querySelectorAll('img'));
      await Promise.all(
        images.map(async (img) => {
          const raw = img.getAttribute('src') || '';
          if (!raw || /^(data:|blob:)/i.test(raw)) return;

          let url;
          try {
            url = new URL(raw, document.baseURI);
          } catch (err) {
            return;
          }

          // Make relative URLs absolute so they still resolve elsewhere.
          if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) img.setAttribute('src', url.href);

          if (url.origin !== window.location.origin) return;
          if (total > MAX_INLINE_TOTAL_BYTES) return;

          try {
            const response = await fetch(url.href);
            if (!response.ok) return;
            const blob = await response.blob();
            if (!blob.size || blob.size > MAX_INLINE_IMAGE_BYTES) return;
            if (total + blob.size > MAX_INLINE_TOTAL_BYTES) return;
            total += blob.size;
            img.setAttribute('src', await readAsDataUrl(blob));
          } catch (err) {
            // Keep the absolute URL — the export still renders online.
          }
        })
      );
    }

    return serializeBody(doc);
  }

  /* ---------- Document assembly ---------- */

  function formatDate(value) {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    try {
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch (err) {
      return date.toISOString().slice(0, 10);
    }
  }

  function buildDocument(options) {
    const opts = options || {};
    const title = opts.title || 'Untitled document';
    const forPrint = !!opts.forPrint;
    const footer = forPrint
      ? '<footer class="doc-footer">Exported from Markdown Studio · ' +
        escape(formatDate(opts.date)) +
        '</footer>'
      : '';

    return (
      '<!DOCTYPE html>\n' +
      '<html lang="en">\n<head>\n' +
      '<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '<meta name="generator" content="Markdown Studio">\n' +
      '<meta name="color-scheme" content="light dark">\n' +
      '<title>' + escape(title) + '</title>\n' +
      '<style>' + DOCUMENT_CSS + '</style>\n' +
      '</head>\n<body>\n' +
      '<article class="markdown-body">\n' +
      (opts.bodyHtml || '') +
      '\n' + footer + '\n' +
      '</article>\n</body>\n</html>\n'
    );
  }

  /* ---------- Export as .html ---------- */

  async function exportHtml(filename, title, bodyHtml) {
    try {
      const clean = await cleanBody(bodyHtml, { inlineImages: true });
      const html = buildDocument({ title: title, bodyHtml: clean });
      return Utils.downloadFile(filename, html, 'text/html');
    } catch (err) {
      console.error('HTML export failed:', err);
      return false;
    }
  }

  /* ---------- Print / save as PDF ---------- */

  let activeFrame = null;

  function removeActiveFrame() {
    if (!activeFrame) return;
    try {
      activeFrame.remove();
    } catch (err) {
      // Already detached.
    }
    activeFrame = null;
  }

  function writeFrame(frame, html) {
    const doc = frame.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
  }

  async function printDocument(title, bodyHtml) {
    try {
      const clean = await cleanBody(bodyHtml, { inlineImages: true });
      const html = buildDocument({ title: title, bodyHtml: clean, forPrint: true });

      removeActiveFrame();

      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('title', 'Print preview');
      frame.style.cssText =
        'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
      document.body.appendChild(frame);
      activeFrame = frame;
      writeFrame(frame, html);

      const win = frame.contentWindow;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (activeFrame === frame) removeActiveFrame();
      };

      win.addEventListener('afterprint', () => setTimeout(finish, 400), { once: true });
      // Safety net: never leave the iframe around if afterprint is not fired.
      setTimeout(finish, 120000);

      // Wait for the written document and its images to load before opening
      // the print dialog. The cap guarantees a broken image or a stuck load
      // can never block the export.
      const docReady = () => {
        if (win.document.readyState === 'complete') return Promise.resolve();
        return new Promise((resolve) => {
          win.addEventListener('load', resolve, { once: true });
        });
      };

      const imagesReady = () =>
        Promise.all(
          Array.prototype.slice.call(win.document.images).map((img) => {
            if (img.complete) return Promise.resolve();
            return new Promise((resolve) => {
              img.addEventListener('load', resolve, { once: true });
              img.addEventListener('error', resolve, { once: true });
            });
          })
        );

      Promise.race([
        docReady().then(imagesReady),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ])
        .then(() => {
          win.focus();
          win.print();
        })
        .catch((err) => {
          console.error('Could not open the print dialog:', err);
          finish();
        });

      return true;
    } catch (err) {
      console.error('PDF export failed:', err);
      removeActiveFrame();
      return false;
    }
  }

  window.Exporter = {
    buildDocument,
    cleanBody,
    exportHtml,
    printDocument,
  };
})();
