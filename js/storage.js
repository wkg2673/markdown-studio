/* ============================================================
   Markdown Studio — storage.js
   localStorage persistence: documents, settings, last session.
   All failures (quota, private mode, corrupted data) are handled
   gracefully and exposed through `Storage.available`.
   ============================================================ */

'use strict';

(function () {
  const KEY_DOCS = 'mdstudio.docs.v1';
  const KEY_SESSION = 'mdstudio.session.v1';
  const KEY_SETTINGS = 'mdstudio.settings.v1';

  const DEFAULT_SETTINGS = {
    theme: 'dark',          // 'dark' | 'light'
    fontSize: 15,            // editor font size in px
    editorFont: 'mono',      // 'mono' | 'sans' | 'serif'
    previewFont: 'sans',    // 'sans' | 'serif' | 'mono'
    lineNumbers: true,
    tabSize: 2,
    gfmBreaks: true,
    syncScroll: true,
    autosave: true,
    viewMode: 'split',      // 'split' | 'editor' | 'preview'
    divider: 0.5,
    sidebar: 'expanded',    // 'expanded' | 'collapsed' | 'open' (mobile overlay)
  };

  const available = (function () {
    try {
      const probe = '__mdstudio_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return true;
    } catch (err) {
      console.warn('localStorage unavailable — documents will not persist:', err);
      return false;
    }
  })();

  /* Fallback in-memory store, used when localStorage is blocked
     (private browsing, storage disabled, etc.). Data lives for the
     current session only. */
  const memoryStore = {};

  function readKey(key, fallback) {
    try {
      const raw = available ? localStorage.getItem(key) : memoryStore[key];
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (err) {
      console.warn('Could not read "' + key + '" from storage — using fallback.', err);
      return fallback;
    }
  }

  function writeKey(key, value) {
    const raw = JSON.stringify(value);
    try {
      if (available) localStorage.setItem(key, raw);
      else memoryStore[key] = raw;
      return true;
    } catch (err) {
      console.warn('Could not write "' + key + '" to storage.', err);
      return false;
    }
  }

  /* ---------- Documents ---------- */

  function readDocs() {
    return readKey(KEY_DOCS, {});
  }

  function writeDocs(docs) {
    return writeKey(KEY_DOCS, docs);
  }

  function listDocs() {
    const docs = readDocs();
    return Object.keys(docs)
      .map((id) => docs[id])
      .filter(Boolean)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function getDoc(id) {
    if (!id) return null;
    const docs = readDocs();
    return docs[id] || null;
  }

  /** Create a new document. Returns the stored doc object. */
  function createDoc(title, content) {
    const now = Date.now();
    const doc = {
      id: Utils.uid(),
      title: title || 'Untitled',
      content: content != null ? content : '',
      createdAt: now,
      updatedAt: now,
    };
    const docs = readDocs();
    docs[doc.id] = doc;
    writeDocs(docs);
    return doc;
  }

  /** Insert or update a full document object. */
  function saveDoc(doc) {
    const now = Date.now();
    const stored = Object.assign({}, doc, { updatedAt: now });
    const docs = readDocs();
    docs[stored.id] = stored;
    const ok = writeDocs(docs);
    return { ok, doc: stored };
  }

  function deleteDoc(id) {
    const docs = readDocs();
    if (!(id in docs)) return false;
    delete docs[id];
    writeDocs(docs);
    return true;
  }

  function renameDoc(id, title) {
    const docs = readDocs();
    if (!docs[id]) return false;
    docs[id].title = title;
    docs[id].updatedAt = Date.now();
    writeDocs(docs);
    return true;
  }

  /* ---------- Session ---------- */

  function getLastOpenedId() {
    const session = readKey(KEY_SESSION, {});
    const id = session.lastOpenedId;
    // Validate against actual documents so we never restore a ghost id.
    return id && getDoc(id) ? id : null;
  }

  function setLastOpenedId(id) {
    writeKey(KEY_SESSION, { lastOpenedId: id });
  }

  /* ---------- Settings ---------- */

  function getSettings() {
    const stored = readKey(KEY_SETTINGS, {});
    // Merge with defaults so new keys get sane values after upgrades.
    return Object.assign({}, DEFAULT_SETTINGS, stored);
  }

  function saveSettings(patch) {
    const next = Object.assign({}, getSettings(), patch);
    writeKey(KEY_SETTINGS, next);
    return next;
  }

  /* ---------- Diagnostics ---------- */

  function storageUsage() {
    let bytes = 0;
    const keys = [KEY_DOCS, KEY_SESSION, KEY_SETTINGS];
    for (const key of keys) {
      try {
        const raw = available ? localStorage.getItem(key) : memoryStore[key];
        if (raw) bytes += raw.length * 2; // UTF-16
      } catch (err) { /* ignore */ }
    }
    return bytes;
  }

  function resetAll() {
    try {
      if (available) {
        [KEY_DOCS, KEY_SESSION, KEY_SETTINGS].forEach((k) => localStorage.removeItem(k));
      } else {
        [KEY_DOCS, KEY_SESSION, KEY_SETTINGS].forEach((k) => delete memoryStore[k]);
      }
      return true;
    } catch (err) {
      console.warn('Could not reset storage.', err);
      return false;
    }
  }

  window.Storage = {
    available,
    KEY_DOCS,
    DEFAULT_SETTINGS,
    listDocs,
    getDoc,
    createDoc,
    saveDoc,
    deleteDoc,
    renameDoc,
    getLastOpenedId,
    setLastOpenedId,
    getSettings,
    saveSettings,
    storageUsage,
    resetAll,
  };
})();
