/* ============================================================
   Markdown Studio — app.js
   Application controller: document management, sidebar, top bar,
   settings, find & replace UI, view modes, shortcuts, autosave.
   ============================================================ */

'use strict';

(function () {
  /* ---------- Element references ---------- */

  const appEl = $('#app');
  const sidebarEl = $('#sidebar');
  const sidebarBackdrop = $('#sidebar-backdrop');
  const docListEl = $('#doc-list');
  const sidebarMeta = $('#sidebar-meta');

  const editorPane = $('#editor-pane');
  const previewPane = $('#preview-pane');
  const previewEl = $('#preview');
  const editorArea = $('#editor-area');
  const dividerEl = $('#divider');

  const findPanel = $('#find-panel');
  const findInput = $('#find-input');
  const replaceInput = $('#replace-input');
  const findCountEl = $('#find-count');
  const findCaseBtn = $('#find-case');

  const headingMenu = $('#heading-menu');
  const moreMenu = $('#more-menu');

  const confirmBackdrop = $('#confirm-backdrop');
  const promptBackdrop = $('#prompt-backdrop');
  const settingsBackdrop = $('#settings-backdrop');

  const fileInput = $('#file-input');
  const toastContainer = $('#toast-container');

  /* ---------- State ---------- */

  let settings = Storage.getSettings();
  let currentDoc = null;
  let dirty = false;
  let editor = null;
  let toolbarApi = null;
  let modalOpen = false;
  let chordUntil = 0;

  const isMobile = () => window.matchMedia('(max-width: 900px)').matches;

  /* ---------- Toasts ---------- */

  function toast(message, type) {
    const el = document.createElement('div');
    el.className = 'toast ' + (type || 'success');
    const iconName = type === 'error' ? 'alert' : type === 'info' ? 'info' : 'circle-check';
    el.innerHTML = icon(iconName) + '<span></span>';
    el.lastElementChild.textContent = message;
    toastContainer.append(el);
    setTimeout(() => {
      el.classList.add('leaving');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }, type === 'error' ? 4200 : 2400);
  }

  /* ---------- Modals ---------- */

  function openModal(backdrop) {
    backdrop.hidden = false;
    modalOpen = true;
  }

  function closeModal(backdrop) {
    backdrop.hidden = true;
    modalOpen = false;
  }

  function showConfirm(opts) {
    return new Promise((resolve) => {
      $('#confirm-title').textContent = opts.title || 'Are you sure?';
      $('#confirm-message').textContent = opts.message || '';
      const okBtn = $('#confirm-ok');
      okBtn.textContent = opts.confirmText || 'Delete';
      openModal(confirmBackdrop);
      okBtn.focus();

      const done = (result) => {
        closeModal(confirmBackdrop);
        okBtn.onclick = $('#confirm-cancel').onclick = null;
        confirmBackdrop.onclick = null;
        resolve(result);
      };
      okBtn.onclick = () => done(true);
      $('#confirm-cancel').onclick = () => done(false);
      confirmBackdrop.onclick = (e) => {
        if (e.target === confirmBackdrop) done(false);
      };
    });
  }

  function showPrompt(opts) {
    return new Promise((resolve) => {
      $('#prompt-title').textContent = opts.title || '';
      const input = $('#prompt-input');
      $('#prompt-label').textContent = opts.label || 'Name';
      $('#prompt-ok').textContent = opts.okText || 'OK';
      input.value = opts.value || '';
      openModal(promptBackdrop);
      input.focus();
      input.select();

      const done = (result) => {
        closeModal(promptBackdrop);
        $('#prompt-ok').onclick = $('#prompt-cancel').onclick = null;
        input.onkeydown = null;
        promptBackdrop.onclick = null;
        resolve(result);
      };
      const submit = () => {
        const value = input.value.trim();
        if (!value) {
          input.reportValidity ? input.setCustomValidity('') : null;
          input.focus();
          return;
        }
        done(value);
      };
      $('#prompt-ok').onclick = submit;
      $('#prompt-cancel').onclick = () => done(null);
      input.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
      };
      promptBackdrop.onclick = (e) => {
        if (e.target === promptBackdrop) done(null);
      };
    });
  }

  /* ---------- Theme ---------- */

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $('#btn-theme').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#101216' : '#f7f8fa');
    settings.theme = theme;
    persistSettings();
  }

  function toggleTheme() {
    applyTheme(settings.theme === 'dark' ? 'light' : 'dark');
  }

  /* ---------- Settings ---------- */

  function persistSettings() {
    Storage.saveSettings(settings);
  }

  function applySettingsToUi() {
    document.documentElement.dataset.theme = settings.theme;
    $('#btn-theme').innerHTML = icon(settings.theme === 'dark' ? 'sun' : 'moon');

    const surface = editor ? editor.surface : editorPane.querySelector('.editor-surface');
    if (surface) {
      surface.style.setProperty('--editor-font-size', settings.fontSize + 'px');
      surface.dataset.font = settings.editorFont;
    }
    previewEl.dataset.font = settings.previewFont;

    setViewMode(settings.viewMode, { silent: true });
    setDivider(settings.divider, { silent: true });

    if (!isMobile() && settings.sidebar === 'collapsed') {
      appEl.classList.add('sidebar-collapsed');
    }
    updateSaveStatus();
  }

  function openSettings() {
    // Populate controls from current settings.
    $('#set-font-size').value = String(settings.fontSize);
    $('#set-font-size-out').textContent = settings.fontSize + 'px';
    $('#set-editor-font').value = settings.editorFont;
    $('#set-preview-font').value = settings.previewFont;
    $('#set-line-numbers').checked = settings.lineNumbers;
    $('#set-tab').value = String(settings.tabSize);
    $('#set-breaks').checked = settings.gfmBreaks;
    $('#set-sync-scroll').checked = settings.syncScroll;
    $('#set-autosave').checked = settings.autosave;

    const usage = Storage.storageUsage();
    $('#settings-storage-usage').textContent = formatBytes(usage) + ' used';

    openModal(settingsBackdrop);
    $('#settings-close').focus();
  }

  function bindSettingsControls() {
    $('#set-font-size').addEventListener('input', (e) => {
      settings.fontSize = parseInt(e.target.value, 10);
      $('#set-font-size-out').textContent = settings.fontSize + 'px';
      if (editor) editor.surface.style.setProperty('--editor-font-size', settings.fontSize + 'px');
      persistSettings();
    });

    $('#set-editor-font').addEventListener('change', (e) => {
      settings.editorFont = e.target.value;
      if (editor) editor.surface.dataset.font = settings.editorFont;
      persistSettings();
    });

    $('#set-preview-font').addEventListener('change', (e) => {
      settings.previewFont = e.target.value;
      previewEl.dataset.font = settings.previewFont;
      persistSettings();
    });

    $('#set-line-numbers').addEventListener('change', (e) => {
      settings.lineNumbers = e.target.checked;
      if (editor) editor.setOptions({ lineNumbers: settings.lineNumbers });
      persistSettings();
    });

    $('#set-tab').addEventListener('change', (e) => {
      settings.tabSize = parseInt(e.target.value, 10);
      if (editor) editor.setOptions({ tabSize: settings.tabSize });
      persistSettings();
    });

    $('#set-breaks').addEventListener('change', (e) => {
      settings.gfmBreaks = e.target.checked;
      persistSettings();
      renderPreviewNow();
    });

    $('#set-sync-scroll').addEventListener('change', (e) => {
      settings.syncScroll = e.target.checked;
      persistSettings();
    });

    $('#set-autosave').addEventListener('change', (e) => {
      settings.autosave = e.target.checked;
      persistSettings();
      updateSaveStatus();
      if (settings.autosave && dirty) scheduleAutosave();
    });

    $('#set-theme-dark').addEventListener('click', () => applyTheme('dark'));
    $('#set-theme-light').addEventListener('click', () => applyTheme('light'));

    $('#settings-close').addEventListener('click', () => closeModal(settingsBackdrop));
    settingsBackdrop.addEventListener('click', (e) => {
      if (e.target === settingsBackdrop) closeModal(settingsBackdrop);
    });

    $('#btn-reset-all').addEventListener('click', async () => {
      const ok = await showConfirm({
        title: 'Reset all data?',
        message:
          'Every document and setting stored in this browser will be deleted, ' +
          'and the welcome document will be restored. This cannot be undone.',
        confirmText: 'Reset everything',
      });
      if (!ok) return;
      Storage.resetAll();
      Storage.createDoc('Welcome to Markdown Studio', WELCOME_CONTENT);
      window.location.reload();
    });
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /* ---------- Documents ---------- */

  function createDocument() {
    showPrompt({
      title: 'New document',
      label: 'Document name',
      value: nextUntitledTitle(),
      okText: 'Create',
    }).then((name) => {
      if (!name) return;
      const doc = Storage.createDoc(name, '');
      switchDoc(doc.id);
      toast('Created "' + name + '"');
      if (editor) editor.focus();
    });
  }

  function nextUntitledTitle() {
    const docs = Storage.listDocs();
    let n = docs.length + 1;
    const titles = new Set(docs.map((d) => d.title));
    while (titles.has('Untitled ' + n)) n++;
    return 'Untitled ' + n;
  }

  function switchDoc(id) {
    if (currentDoc && currentDoc.id === id) return;
    saveNow({ silent: true });

    const doc = Storage.getDoc(id);
    if (!doc) {
      console.warn('switchDoc: unknown id', id);
      return;
    }

    currentDoc = doc;
    dirty = false;
    Storage.setLastOpenedId(id);

    editor.setValue(doc.content);
    previewPane.scrollTop = 0;
    closeFind();
    updateDocName();
    renderSidebar();
    renderPreviewNow();
    updateStatsNow();
    updateSaveStatus();
    if (isMobile()) appEl.classList.remove('sidebar-open');
  }

  function renameDocument() {
    if (!currentDoc) return;
    showPrompt({
      title: 'Rename document',
      label: 'Document name',
      value: currentDoc.title,
      okText: 'Rename',
    }).then((name) => {
      if (!name || name === currentDoc.title) return;
      saveNow({ silent: true });
      Storage.renameDoc(currentDoc.id, name);
      currentDoc.title = name;
      updateDocName();
      renderSidebar();
      toast('Renamed to "' + name + '"');
    });
  }

  async function deleteDocument(id) {
    const doc = Storage.getDoc(id);
    if (!doc) return;
    const ok = await showConfirm({
      title: 'Delete document?',
      message: '"' + doc.title + '" will be permanently removed from this browser.',
      confirmText: 'Delete',
    });
    if (!ok) return;

    Storage.deleteDoc(id);
    if (currentDoc && currentDoc.id === id) {
      const remaining = Storage.listDocs();
      if (remaining.length) {
        currentDoc = null;
        switchDoc(remaining[0].id);
      } else {
        const fresh = Storage.createDoc('Untitled', '');
        currentDoc = null;
        switchDoc(fresh.id);
      }
    }
    renderSidebar();
    toast('Document deleted');
  }

  function updateDocName() {
    if (!currentDoc) return;
    $('#doc-name-text').textContent = currentDoc.title;
    document.title = currentDoc.title + ' — Markdown Studio';
  }

  /* ---------- Sidebar ---------- */

  function renderSidebar() {
    const docs = Storage.listDocs();
    docListEl.innerHTML = '';

    docs.forEach((doc) => {
      const item = document.createElement('div');
      item.className = 'doc-item' + (currentDoc && doc.id === currentDoc.id ? ' active' : '');
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.dataset.id = doc.id;
      item.setAttribute(
        'aria-current',
        currentDoc && doc.id === currentDoc.id ? 'true' : 'false'
      );

      const info = document.createElement('div');
      info.className = 'doc-item-info';
      const title = document.createElement('span');
      title.className = 'doc-item-title';
      title.textContent = doc.title;
      const meta = document.createElement('span');
      meta.className = 'doc-item-meta';
      meta.textContent = 'edited ' + Utils.formatRelativeTime(doc.updatedAt);
      info.append(title, meta);

      const iconWrap = document.createElement('span');
      iconWrap.className = 'doc-icon';
      iconWrap.innerHTML = icon('file-text');

      const actions = document.createElement('span');
      actions.className = 'doc-item-actions';
      actions.innerHTML =
        '<button type="button" class="icon-btn" data-action="rename" aria-label="Rename ' +
        Utils.escapeHtml(doc.title) +
        '" title="Rename">' +
        icon('pencil') +
        '</button>' +
        '<button type="button" class="icon-btn danger" data-action="delete" aria-label="Delete ' +
        Utils.escapeHtml(doc.title) +
        '" title="Delete">' +
        icon('trash') +
        '</button>';

      item.append(iconWrap, info, actions);

      item.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (btn) {
          e.stopPropagation();
          if (btn.dataset.action === 'rename') {
            if (doc.id === (currentDoc && currentDoc.id)) renameDocument();
            else {
              showPrompt({ title: 'Rename document', label: 'Document name', value: doc.title, okText: 'Rename' })
                .then((name) => {
                  if (!name) return;
                  Storage.renameDoc(doc.id, name);
                  if (currentDoc && currentDoc.id === doc.id) {
                    currentDoc.title = name;
                    updateDocName();
                  }
                  renderSidebar();
                  toast('Renamed to "' + name + '"');
                });
            }
          } else {
            deleteDocument(doc.id);
          }
          return;
        }
        switchDoc(doc.id);
      });

      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          switchDoc(doc.id);
        }
      });

      docListEl.append(item);
    });

    const usage = Storage.storageUsage();
    sidebarMeta.textContent =
      Utils.pluralize(docs.length, 'document') + ' · ' + formatBytes(usage) + ' · local';
  }

  function toggleSidebar() {
    if (isMobile()) {
      appEl.classList.toggle('sidebar-open');
    } else {
      const collapsed = appEl.classList.toggle('sidebar-collapsed');
      settings.sidebar = collapsed ? 'collapsed' : 'expanded';
      persistSettings();
    }
  }

  /* ---------- Saving ---------- */

  const scheduleAutosave = Utils.debounce(() => saveNow(), 800);

  function saveNow(opts) {
    const options = opts || {};
    if (!currentDoc) return;
    if (!Storage.available) {
      updateSaveStatus('error');
      return;
    }

    const content = editor.getValue();
    if (!dirty && content === currentDoc.content) {
      updateSaveStatus('saved');
      return;
    }

    const result = Storage.saveDoc(Object.assign({}, currentDoc, { content }));
    if (result.ok) {
      currentDoc = result.doc;
      dirty = false;
      updateSaveStatus('saved');
      renderSidebar();
      if (!options.silent) toast('Saved locally');
    } else {
      updateSaveStatus('error');
      if (!options.silent) {
        toast('Could not save — browser storage is full or blocked.', 'error');
      }
    }
  }

  function updateSaveStatus(state) {
    const el = $('#save-status');
    const text = $('#save-status-text');
    el.classList.remove('dirty', 'error');

    if (!Storage.available) {
      el.classList.add('error');
      text.textContent = 'No storage';
      return;
    }
    if (!settings.autosave) {
      el.classList.add('dirty');
      text.textContent = 'Autosave off';
      return;
    }

    switch (state) {
      case 'saving':
        el.classList.add('dirty');
        text.textContent = 'Saving…';
        break;
      case 'error':
        el.classList.add('error');
        text.textContent = 'Save failed';
        break;
      case 'saved':
        text.textContent = 'Saved ' + Utils.formatTime(Date.now());
        break;
      default:
        if (dirty) {
          el.classList.add('dirty');
          text.textContent = 'Unsaved changes';
        } else {
          text.textContent = currentDoc ? 'Saved ' + Utils.formatTime(currentDoc.updatedAt) : 'Ready';
        }
    }
  }

  /* ---------- Import / export ---------- */

  function importFiles() {
    fileInput.click();
  }

  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = '';
    if (!files.length) return;

    let imported = 0;
    let lastId = null;
    for (const file of files) {
      try {
        if (file.size > 8 * 1024 * 1024) {
          toast('Skipped "' + file.name + '" — larger than 8 MB.', 'error');
          continue;
        }
        const text = await file.text();
        const title = file.name.replace(/\.(md|markdown|txt)$/i, '') || 'Imported document';
        const doc = Storage.createDoc(title, text);
        imported++;
        lastId = doc.id;
      } catch (err) {
        console.error('Import failed for', file.name, err);
        toast('Could not read "' + file.name + '".', 'error');
      }
    }

    if (imported) {
      if (lastId) switchDoc(lastId);
      renderSidebar();
      toast('Imported ' + Utils.pluralize(imported, 'document'));
    }
  });

  function exportDocument() {
    if (!currentDoc) return;
    saveNow({ silent: true });
    const filename = Utils.sanitizeFilename(currentDoc.title) + '.md';
    const ok = Utils.downloadFile(filename, editor.getValue(), 'text/markdown');
    if (ok) toast('Exported ' + filename);
    else toast('Export failed — your browser blocked the download.', 'error');
  }

  /* ---------- Copy actions ---------- */

  async function copySource() {
    const ok = await Utils.copyToClipboard(editor.getValue());
    toast(ok ? 'Markdown source copied' : 'Copy failed', ok ? 'success' : 'error');
  }

  async function copyRenderedHtml() {
    const ok = await Utils.copyToClipboard(Markdown.render(editor.getValue(), { breaks: settings.gfmBreaks }));
    toast(ok ? 'Rendered HTML copied' : 'Copy failed', ok ? 'success' : 'error');
  }

  async function copyPreviewText() {
    const ok = await Utils.copyToClipboard(previewEl.innerText);
    toast(ok ? 'Preview text copied' : 'Copy failed', ok ? 'success' : 'error');
  }

  /* ---------- Preview ---------- */

  const schedulePreview = Utils.debounce(renderPreviewNow, 120);

  function renderPreviewNow() {
    const text = editor.getValue();
    if (!text.trim()) {
      previewEl.innerHTML =
        '<div class="preview-empty">' +
        icon('file-text') +
        '<span>Nothing to preview yet</span>' +
        '<span>Start writing Markdown in the editor — the rendered result appears here instantly.</span>' +
        '</div>';
      return;
    }
    previewEl.innerHTML = Markdown.render(text, { breaks: settings.gfmBreaks });
  }

  previewPane.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy-code]');
    if (!btn) return;
    const code = btn.closest('.code-block');
    if (!code) return;
    const ok = await Utils.copyToClipboard(code.querySelector('code').textContent);
    if (ok) {
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 1200);
      toast('Code copied');
    } else {
      toast('Copy failed', 'error');
    }
  });

  /* ---------- Stats ---------- */

  const scheduleStats = Utils.debounce(updateStatsNow, 200);

  function updateStatsNow() {
    const text = editor.getValue();
    const words = Utils.countWords(text);
    $('#stat-words .stat-value').textContent = Utils.pluralize(words, 'word');
    $('#stat-chars').textContent = Utils.pluralize(text.length, 'character');
    $('#stat-lines').textContent = Utils.pluralize(text.split('\n').length, 'line');
    $('#stat-reading .stat-value').textContent = Utils.readingTime(words);
  }

  /* ---------- Scroll sync (editor ↔ preview) ---------- */

  let scrollLockUntil = 0;

  function syncScrollTo(target, sourceInfo) {
    if (!settings.syncScroll) return;
    const now = performance.now();
    if (now < scrollLockUntil) return;
    const denom = sourceInfo.scrollHeight - sourceInfo.clientHeight;
    if (denom <= 0) return;
    const targetDenom = target.scrollHeight - target.clientHeight;
    if (targetDenom <= 0) return;
    scrollLockUntil = now + 120;
    target.scrollTop = (sourceInfo.scrollTop / denom) * targetDenom;
  }

  /* ---------- View modes & divider ---------- */

  function setViewMode(mode, opts) {
    const options = opts || {};
    editorArea.dataset.mode = mode;
    $$('.view-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    if (!options.silent) {
      settings.viewMode = mode;
      persistSettings();
    }
  }

  function setDivider(ratio, opts) {
    const options = opts || {};
    const value = Utils.clamp(ratio || 0.5, 0.15, 0.85);
    editorPane.style.flexBasis = (value * 100).toFixed(2) + '%';
    if (!options.silent) {
      settings.divider = value;
      persistSettings();
    }
  }

  function initDivider() {
    let dragging = false;

    dividerEl.addEventListener('pointerdown', (e) => {
      dragging = true;
      dividerEl.classList.add('dragging');
      dividerEl.setPointerCapture(e.pointerId);
      document.body.classList.add('divider-dragging');
    });

    dividerEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const rect = editorArea.getBoundingClientRect();
      const vertical = getComputedStyle(editorArea).flexDirection === 'column';
      const ratio = vertical
        ? (e.clientY - rect.top) / rect.height
        : (e.clientX - rect.left) / rect.width;
      setDivider(ratio);
    });

    const stop = () => {
      if (!dragging) return;
      dragging = false;
      dividerEl.classList.remove('dragging');
      document.body.classList.remove('divider-dragging');
    };
    dividerEl.addEventListener('pointerup', stop);
    dividerEl.addEventListener('pointercancel', stop);
    dividerEl.addEventListener('dblclick', () => setDivider(0.5));
  }

  /* ---------- Fullscreen ---------- */

  function usePseudoFullscreen() {
    appEl.classList.add('pseudo-fullscreen');
    $('#btn-fullscreen').innerHTML = icon('minimize');
  }

  function toggleFullscreen() {
    if (appEl.classList.contains('pseudo-fullscreen')) {
      appEl.classList.remove('pseudo-fullscreen');
      $('#btn-fullscreen').innerHTML = icon('maximize');
      return;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen();
      return;
    }
    try {
      const promise = appEl.requestFullscreen();
      if (promise && promise.catch) {
        let settled = false;
        promise.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
            usePseudoFullscreen();
          }
        );
        // Some embedded browsers never settle the Fullscreen promise; use
        // the CSS fallback after a short grace period.
        setTimeout(() => {
          if (!settled && !document.fullscreenElement) usePseudoFullscreen();
        }, 1500);
      }
    } catch (err) {
      usePseudoFullscreen();
    }
  }

  document.addEventListener('fullscreenchange', () => {
    const active = !!document.fullscreenElement;
    $('#btn-fullscreen').innerHTML = icon(active ? 'minimize' : 'maximize');
    if (!active) appEl.classList.remove('pseudo-fullscreen');
  });

  /* ---------- Menus ---------- */

  function positionMenu(menu, anchor) {
    menu.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const top = Math.min(rect.bottom + 6, window.innerHeight - menuRect.height - 8);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuRect.width - 8));
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';
  }

  function closeMenus() {
    headingMenu.hidden = true;
    moreMenu.hidden = true;
    $('#tb-heading').setAttribute('aria-expanded', 'false');
    $('#btn-more').setAttribute('aria-expanded', 'false');
  }

  function menuIsOpen() {
    return !headingMenu.hidden || !moreMenu.hidden;
  }

  function initMenus() {
    $('#tb-heading').addEventListener('click', (e) => {
      e.stopPropagation();
      if (headingMenu.hidden) {
        closeMenus();
        positionMenu(headingMenu, e.currentTarget);
        $('#tb-heading').setAttribute('aria-expanded', 'true');
      } else {
        closeMenus();
      }
    });

    headingMenu.addEventListener('click', (e) => {
      const item = e.target.closest('[data-level]');
      if (!item) return;
      toolbarApi.runCommand('heading', parseInt(item.dataset.level, 10));
      closeMenus();
    });

    $('#btn-more').addEventListener('click', (e) => {
      e.stopPropagation();
      if (moreMenu.hidden) {
        closeMenus();
        positionMenu(moreMenu, e.currentTarget);
        $('#btn-more').setAttribute('aria-expanded', 'true');
      } else {
        closeMenus();
      }
    });

    document.addEventListener('click', (e) => {
      if (menuIsOpen() && !e.target.closest('.menu')) closeMenus();
    });

    $('#menu-copy-source').addEventListener('click', () => {
      closeMenus();
      copySource();
    });
    $('#menu-copy-html').addEventListener('click', () => {
      closeMenus();
      copyRenderedHtml();
    });
    $('#menu-copy-preview').addEventListener('click', () => {
      closeMenus();
      copyPreviewText();
    });
    $('#menu-rename').addEventListener('click', () => {
      closeMenus();
      renameDocument();
    });
    $('#menu-print').addEventListener('click', () => {
      closeMenus();
      window.print();
    });
  }

  /* ---------- Find & replace ---------- */

  const scheduleFindUpdate = Utils.debounce(updateFindResults, 140);

  function openFind(prefill, focusReplace) {
    findPanel.hidden = false;
    if (typeof prefill === 'string' && prefill) {
      findInput.value = prefill;
    }
    if (focusReplace) replaceInput.focus();
    else {
      findInput.focus();
      findInput.select();
    }
    updateFindResults();
  }

  function closeFind() {
    if (findPanel.hidden) return;
    findPanel.hidden = true;
    editor.clearFind();
    findCountEl.textContent = '';
    if (document.activeElement === findInput || document.activeElement === replaceInput) {
      editor.focus();
    }
  }

  function findIsOpen() {
    return !findPanel.hidden;
  }

  function updateFindResults() {
    if (findPanel.hidden) return;
    const { count, current } = editor.setFind({
      query: findInput.value,
      caseSensitive: findCaseBtn.getAttribute('aria-pressed') === 'true',
    });
    if (!findInput.value) {
      findCountEl.textContent = '';
    } else if (!count) {
      findCountEl.textContent = '0 results';
    } else {
      findCountEl.textContent = current + 1 + '/' + count;
    }
  }

  function findJump(direction) {
    const result = editor.jumpMatch(direction);
    if (result) findCountEl.textContent = result.index + 1 + '/' + result.count;
    // Keep focus in the find box so Enter keeps cycling matches.
    if (findIsOpen()) findInput.focus({ preventScroll: true });
  }

  function initFind() {
    $('#btn-find').addEventListener('click', () => {
      if (findIsOpen()) closeFind();
      else {
        const sel = editor.getSelection();
        const text = editor.getValue().slice(sel.start, sel.end);
        openFind(text.includes('\n') || text.length > 80 ? '' : text);
      }
    });

    $('#find-close').addEventListener('click', closeFind);

    findInput.addEventListener('input', scheduleFindUpdate);
    findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        findJump(e.shiftKey ? 'prev' : 'next');
      }
    });
    findInput.addEventListener('blur', () => {
      // Keep the panel; marks remain until closed.
    });

    findCaseBtn.addEventListener('click', () => {
      const pressed = findCaseBtn.getAttribute('aria-pressed') === 'true';
      findCaseBtn.setAttribute('aria-pressed', String(!pressed));
      findCaseBtn.classList.toggle('active', !pressed);
      updateFindResults();
    });

    $('#find-prev').addEventListener('click', () => findJump('prev'));
    $('#find-next').addEventListener('click', () => findJump('next'));

    $('#btn-replace').addEventListener('click', () => {
      const ok = editor.replaceCurrent(replaceInput.value);
      if (ok) {
        updateFindResults();
        // Keep focus in the replace box so Enter repeats the replace.
        if (findIsOpen()) replaceInput.focus({ preventScroll: true });
      }
    });

    $('#btn-replace-all').addEventListener('click', () => {
      const count = editor.replaceAll(replaceInput.value);
      updateFindResults();
      editor.focus();
      toast(count ? 'Replaced ' + Utils.pluralize(count, 'occurrence') : 'No matches found', count ? 'success' : 'info');
    });

    replaceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        $('#btn-replace').click();
      }
    });
  }

  /* ---------- Global keyboard shortcuts ---------- */

  function onGlobalKeydown(e) {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;

    // Escape closes the topmost layer.
    if (key === 'Escape') {
      if (modalOpen) {
        [confirmBackdrop, promptBackdrop, settingsBackdrop].forEach((b) => {
          if (!b.hidden) closeModal(b);
        });
        return;
      }
      if (menuIsOpen()) {
        closeMenus();
        return;
      }
      if (findIsOpen()) {
        closeFind();
        return;
      }
      if (appEl.classList.contains('sidebar-open')) {
        appEl.classList.remove('sidebar-open');
        return;
      }
      return;
    }

    if (modalOpen) return; // dialogs handle their own keys
    const inFindPanel =
      findIsOpen() && (e.target === findInput || e.target === replaceInput);
    if (inFindPanel) return;

    // View-mode chord: Ctrl+\ then 1/2/3
    if (!mod && !e.altKey && Date.now() < chordUntil && ['1', '2', '3'].includes(key)) {
      chordUntil = 0;
      e.preventDefault();
      setViewMode(key === '1' ? 'split' : key === '2' ? 'editor' : 'preview');
      return;
    }

    if (!mod) {
      if (e.key === 'F2') {
        e.preventDefault();
        renameDocument();
      } else if (e.key === 'F10') {
        e.preventDefault();
        toggleFullscreen();
      }
      return;
    }

    // Ctrl/Cmd combinations
    switch (true) {
      case key === '\\':
        e.preventDefault();
        toggleSidebar();
        chordUntil = Date.now() + 1500;
        return;

      case key === 's' || key === 'S':
        e.preventDefault();
        exportDocument();
        return;

      case (key === 'n' || key === 'N') && e.altKey:
        e.preventDefault();
        createDocument();
        return;

      case (key === 'o' || key === 'O') && (e.altKey || !e.shiftKey):
        e.preventDefault();
        importFiles();
        return;

      case key === 'f' || key === 'F':
        if (e.shiftKey) break; // Ctrl+Shift+F reserved
        e.preventDefault();
        {
          const sel = editor.getSelection();
          const text = editor.getValue().slice(sel.start, sel.end);
          openFind(text.includes('\n') || text.length > 80 ? '' : text);
        }
        return;

      case key === 'h' || key === 'H':
        if (!e.shiftKey && !e.altKey) {
          e.preventDefault();
          openFind('', true);
        }
        return;

      case key === 'b' || key === 'B':
        if (e.shiftKey && !e.altKey) {
          e.preventDefault();
          toolbarApi.runCommand('quote');
        } else if (!e.shiftKey && !e.altKey) {
          e.preventDefault();
          toolbarApi.runCommand('bold');
        }
        return;

      case key === 'i' || key === 'I':
        if (e.shiftKey && !e.altKey) {
          e.preventDefault();
          toolbarApi.runCommand('image');
        } else if (!e.shiftKey && !e.altKey) {
          e.preventDefault();
          toolbarApi.runCommand('italic');
        }
        return;

      case key === 'k' || key === 'K':
        if (!e.shiftKey && !e.altKey) {
          e.preventDefault();
          toolbarApi.runCommand('link');
        } else if (e.shiftKey) {
          e.preventDefault();
          toolbarApi.runCommand('codeblock');
        }
        return;

      case key === 'x' || key === 'X':
        if (e.shiftKey && !e.altKey) {
          e.preventDefault();
          toolbarApi.runCommand('strikethrough');
        }
        return;

      case key === '`':
        if (!e.shiftKey) {
          e.preventDefault();
          toolbarApi.runCommand('code');
        }
        return;

      case key === 'z' || key === 'Z':
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
        return;

      case key === 'y' || key === 'Y':
        if (!e.shiftKey) {
          e.preventDefault();
          editor.redo();
        }
        return;

      case key === 'l' || key === 'L':
        if (e.shiftKey) {
          e.preventDefault();
          toggleTheme();
        }
        return;

      default:
        break;
    }

    // Digit shortcuts use e.code so shifted symbols (e.g. "&") don't matter.
    if (e.altKey && /^Digit[1-6]$/.test(e.code)) {
      e.preventDefault();
      toolbarApi.runCommand('heading', parseInt(e.code.slice(5), 10));
      return;
    }
    if (e.shiftKey && /^Digit[789]$/.test(e.code)) {
      e.preventDefault();
      toolbarApi.runCommand(e.code === 'Digit7' ? 'ol' : e.code === 'Digit8' ? 'ul' : 'task');
    }
  }

  /* ---------- Boot ---------- */

  function init() {
    Icons.hydrateIcons();

    editor = new Editor(editorPane, {
      tabSize: settings.tabSize,
      lineNumbers: settings.lineNumbers,
    });

    editor.surface.style.setProperty('--editor-font-size', settings.fontSize + 'px');
    editor.surface.dataset.font = settings.editorFont;

    toolbarApi = Toolbar.initToolbar(editor);

    // Editor event pipeline
    editor.on('change', (info) => {
      if (info.source !== 'set') {
        dirty = true;
        if (settings.autosave) {
          updateSaveStatus('saving');
          scheduleAutosave();
        } else {
          updateSaveStatus();
        }
      }
      schedulePreview();
      scheduleStats();
    });

    editor.on('selection', (cursor) => {
      $('#stat-cursor').textContent = 'Ln ' + cursor.line + ', Col ' + cursor.col;
    });

    editor.on('history', () => {
      const undoBtn = $('#btn-undo');
      const redoBtn = $('#btn-redo');
      undoBtn.disabled = !editor.canUndo();
      redoBtn.disabled = !editor.canRedo();
    });

    editor.on('scroll', (info) => syncScrollTo(previewPane, info));

    previewPane.addEventListener(
      'scroll',
      Utils.throttle(() => {
        syncScrollTo(editor.pane, {
          scrollTop: previewPane.scrollTop,
          scrollHeight: previewPane.scrollHeight,
          clientHeight: previewPane.clientHeight,
        });
      }, 40)
    );

    // Top bar
    $('#btn-sidebar-toggle').addEventListener('click', toggleSidebar);
    $('#btn-new-doc').addEventListener('click', createDocument);
    $('#btn-new-doc-side').addEventListener('click', createDocument);
    $('#btn-import').addEventListener('click', importFiles);
    $('#btn-export').addEventListener('click', exportDocument);
    $('#btn-undo').addEventListener('click', () => editor.undo());
    $('#btn-redo').addEventListener('click', () => editor.redo());
    $('#btn-theme').addEventListener('click', toggleTheme);
    $('#btn-fullscreen').addEventListener('click', toggleFullscreen);
    $('#btn-settings').addEventListener('click', openSettings);

    // Status bar
    $('#doc-name').addEventListener('click', renameDocument);

    // Sidebar
    sidebarBackdrop.addEventListener('click', () => appEl.classList.remove('sidebar-open'));

    // View switch
    $$('.view-btn').forEach((btn) => {
      btn.addEventListener('click', () => setViewMode(btn.dataset.mode));
    });

    // Keep sidebar classes coherent when the window crosses the mobile breakpoint.
    const mobileQuery = window.matchMedia('(max-width: 900px)');
    const onBreakpointChange = () => {
      if (mobileQuery.matches) {
        appEl.classList.remove('sidebar-collapsed');
      } else {
        appEl.classList.remove('sidebar-open');
        appEl.classList.toggle('sidebar-collapsed', settings.sidebar === 'collapsed');
      }
    };
    if (typeof mobileQuery.addEventListener === 'function') {
      mobileQuery.addEventListener('change', onBreakpointChange);
    } else if (typeof mobileQuery.addListener === 'function') {
      mobileQuery.addListener(onBreakpointChange); // Safari < 14
    }

    bindSettingsControls();
    initMenus();
    initFind();
    initDivider();

    document.addEventListener('keydown', onGlobalKeydown);
    window.addEventListener('beforeunload', () => {
      if (dirty) saveNow({ silent: true });
    });

    // Load the last opened document (or first-run welcome content).
    let docId = Storage.getLastOpenedId();
    if (!docId) {
      const docs = Storage.listDocs();
      docId = docs.length ? docs[0].id : null;
    }
    if (!docId) {
      const welcome = Storage.createDoc('Welcome to Markdown Studio', WELCOME_CONTENT);
      docId = welcome.id;
    }
    currentDoc = Storage.getDoc(docId);
    editor.setValue(currentDoc ? currentDoc.content : '');

    applySettingsToUi();
    updateDocName();
    renderSidebar();
    renderPreviewNow();
    updateStatsNow();
    updateSaveStatus();

    // Health notices (graceful degradation).
    if (!Storage.available) {
      toast('Browser storage is unavailable — documents will not persist.', 'error');
    }
    if (!Markdown.isReady()) {
      toast('A rendering library failed to load — preview runs in fallback mode.', 'error');
    }

    editor.emit('history');
    editor.emit('selection', editor.getCursor());
  }

  /* ---------- Default welcome content ---------- */

  const WELCOME_CONTENT = [
    '# Welcome to Markdown Studio',
    '',
    'A fast, private, offline-friendly Markdown editor with a **live preview**,',
    'syntax highlighting, and autosave — right in your browser.',
    '',
    '## Formatting',
    '',
    'Combine **bold**, *italic*, ~~strikethrough~~, `inline code`, and [links](https://commonmark.org) freely.',
    'Press `Ctrl+B`, `Ctrl+I`, or use the toolbar above the editor.',
    '',
    '## Lists, tasks & quotes',
    '',
    '- Bullet lists are one keystroke away',
    '  - Nest them with `Tab`',
    '    - As deep as you like',
    '1. Ordered lists renumber themselves',
    '2. Press `Enter` to continue a list — press it again on an empty item to exit',
    '',
    '- [x] Ship the editor',
    '- [x] Add find & replace',
    '- [ ] Write something great',
    '',
    '> Blockquotes get a subtle accent bar.',
    '> They can span several lines.',
    '',
    '## Code blocks',
    '',
    'Fenced blocks are highlighted with highlight.js:',
    '',
    '```javascript',
    '// Try editing this block — the preview updates instantly',
    'function greet(name) {',
    '  return `Hello, ${name}! Welcome to Markdown Studio.`;',
    '}',
    '',
    'console.log(greet("writer"));',
    '```',
    '',
    '```css',
    '/* Works for many languages */',
    '.markdown-body {',
    '  max-width: 76ch;',
    '  line-height: 1.75;',
    '}',
    '```',
    '',
    '## Tables',
    '',
    '| Feature      | Status | Notes                     |',
    '| ------------ | ------ | ------------------------- |',
    '| Live preview | ✅     | Updates as you type       |',
    '| Autosave     | ✅     | Stored in your browser    |',
    '| Export       | ✅     | Download as `.md`         |',
    '| Themes       | ✅     | Dark & light              |',
    '',
    '## Images & rules',
    '',
    '![Markdown Studio sample image](assets/images/sample-image.svg)',
    '',
    '---',
    '',
    '### Footnotes',
    '',
    'Footnotes are supported[^1], including definitions that continue',
    'over multiple indented lines[^note].',
    '',
    '[^1]: Footnote definitions live at the bottom of your document.',
    '[^note]: Indented continuation lines are merged into the definition,',
    '    exactly like on GitHub.',
    '',
    '---',
    '',
    '**Your turn** — click the document name in the status bar to rename this file,',
    'or create a new one from the sidebar. Happy writing! ✍️',
    '',
  ].join('\n');

  document.addEventListener('DOMContentLoaded', init);
})();
