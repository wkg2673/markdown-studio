/* ============================================================
   Markdown Studio — pwa.js
   Progressive Web App plumbing:
   - Registers the service worker (offline support).
   - Captures the install prompt so the UI can offer "Install app".
   - Emits app-level events consumed by app.js:
       pwa:ready       — service worker active
       pwa:installable — install prompt captured
       pwa:installed   — app was installed
       pwa:dismissed    — install prompt was used but not accepted
   ============================================================ */

'use strict';

(function () {
  const canRegister =
    'serviceWorker' in navigator && /^https?:$/.test(window.location.protocol);

  let deferredPrompt = null;

  function emit(name, detail) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail: detail }));
    } catch (err) {
      // CustomEvent is universally available; this is purely defensive.
      console.debug('Could not emit ' + name, err);
    }
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    emit('pwa:installable');
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    emit('pwa:installed');
  });

  async function promptInstall() {
    if (!deferredPrompt) return false;
    const prompt = deferredPrompt;
    deferredPrompt = null;
    try {
      prompt.prompt();
      const choice = await prompt.userChoice;
      const accepted = !!choice && choice.outcome === 'accepted';
      emit(accepted ? 'pwa:installed' : 'pwa:dismissed');
      return accepted;
    } catch (err) {
      console.debug('Install prompt failed:', err);
      return false;
    }
  }

  window.PWA = {
    supported: canRegister,
    canInstall: () => !!deferredPrompt,
    promptInstall,
  };

  if (!canRegister) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('sw.js')
      .then((registration) => {
        emit('pwa:ready', { scope: registration.scope });
      })
      .catch((err) => {
        // Registration fails on insecure origins or when the file is
        // unavailable — the app keeps working normally without it.
        console.debug('Service worker registration failed:', err);
      });
  });
})();
