/* ============================================================
   Markdown Studio — utils.js
   Small dependency-free helpers shared across the app.
   Exposed as window.Utils (and a few globals like $ / $$).
   ============================================================ */

'use strict';

(function () {
  /* ---------- DOM ---------- */

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  /* ---------- Timing ---------- */

  function debounce(fn, wait) {
    let timer = null;
    function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    }
    debounced.cancel = () => clearTimeout(timer);
    debounced.flush = (...args) => {
      clearTimeout(timer);
      fn.apply(this, args);
    };
    return debounced;
  }

  function throttle(fn, wait) {
    let last = 0;
    let timer = null;
    return function throttled(...args) {
      const now = Date.now();
      const remaining = wait - (now - last);
      if (remaining <= 0) {
        last = now;
        clearTimeout(timer);
        fn.apply(this, args);
      } else if (!timer) {
        timer = setTimeout(() => {
          last = Date.now();
          timer = null;
          fn.apply(this, args);
        }, remaining);
      }
    };
  }

  /* ---------- Text & statistics ---------- */

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function countWords(text) {
    if (!text) return 0;
    // Latin-style words (letters/digits, may contain inner ' . - _)
    const words = (text.match(/[\p{L}\p{N}]+(?:[.'’\-_][\p{L}\p{N}]+)*/gu) || []).length;
    // CJK characters count as individual words
    const cjk = (text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g) || []).length;
    return words + cjk;
  }

  function readingTime(words) {
    const minutes = words / 200;
    if (words === 0) return '0 min';
    if (minutes < 1) return '<1 min';
    return Math.round(minutes) + ' min';
  }

  function pluralize(n, one, many) {
    return n === 1 ? n + ' ' + one : n + ' ' + (many || one + 's');
  }

  /* ---------- Dates ---------- */

  function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatRelativeTime(ts) {
    const diff = Date.now() - ts;
    const min = 60 * 1000;
    const hour = 60 * min;
    const day = 24 * hour;

    if (diff < 45 * 1000) return 'just now';
    if (diff < hour) return Math.round(diff / min) + ' min ago';
    if (diff < day) return Math.round(diff / hour) + ' h ago';
    if (diff < 2 * day) return 'yesterday';
    if (diff < 7 * day) return Math.round(diff / day) + ' d ago';

    const d = new Date(ts);
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: sameYear ? undefined : 'numeric',
    });
  }

  /* ---------- Files & clipboard ---------- */

  function sanitizeFilename(name) {
    const cleaned = String(name || '').replace(/[\\/:*?"<>|]/g, '-');
    return cleaned.replace(/\s+/g, ' ').trim().slice(0, 100) || 'untitled';
  }

  function downloadFile(filename, content, mime) {
    try {
      const blob = new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Give the browser a moment before revoking, otherwise some
      // browsers (notably Firefox) may cancel the download.
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return true;
    } catch (err) {
      console.error('Download failed:', err);
      return false;
    }
  }

  /**
   * Copy text to the clipboard. Prefers the async Clipboard API and
   * falls back to a hidden-textarea + execCommand strategy for older
   * browsers or non-secure contexts (e.g. plain file:// pages).
   */
  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      // Expected when the page is unfocused or clipboard permission is denied;
      // the execCommand fallback below handles it.
      console.debug('Async clipboard failed, falling back:', err);
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (err) {
      console.error('Clipboard fallback failed:', err);
      return false;
    }
  }

  /* ---------- Misc ---------- */

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function uid() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  window.Utils = {
    $,
    $$,
    debounce,
    throttle,
    escapeHtml,
    escapeRegExp,
    countWords,
    readingTime,
    pluralize,
    formatTime,
    formatRelativeTime,
    sanitizeFilename,
    downloadFile,
    copyToClipboard,
    clamp,
    uid,
  };

  // Convenience globals used across modules.
  window.$ = $;
  window.$$ = $$;
})();
