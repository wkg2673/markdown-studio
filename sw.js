/* ============================================================
   Markdown Studio — service worker

   Makes the app fully usable offline after the first visit.
   The app shell is precached on install; other same-origin
   requests are cached on first use. Navigations are network-first
   with an offline fallback to the cached shell, so updates are
   picked up automatically when a connection is available.

   Bump CACHE_VERSION whenever the precache list changes.
   ============================================================ */

'use strict';

const CACHE_VERSION = 'v3';
const CACHE_NAME = 'markdown-studio-' + CACHE_VERSION;

const PRECACHE_URLS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/themes.css',
  'css/style.css',
  'css/editor.css',
  'js/icons.js',
  'js/utils.js',
  'js/storage.js',
  'js/markdown.js',
  'js/export.js',
  'js/editor.js',
  'js/toolbar.js',
  'js/pwa.js',
  'js/app.js',
  'vendor/marked.min.js',
  'vendor/purify.min.js',
  'vendor/highlight.min.js',
  'assets/images/favicon.svg',
  'assets/images/sample-image.svg',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-512.png',
  'assets/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('markdown-studio-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

function isCacheable(response) {
  return response && response.ok && (response.type === 'basic' || response.type === 'default');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: try the network, fall back to the cached app shell.
  // A failed request *or* a non-OK response (proxy/captive portal errors,
  // 5xx pages) must not replace the app with an error document.
  if (request.mode === 'navigate') {
    const shellPath = new URL('./', self.location.href).pathname;
    const indexPath = new URL('index.html', self.location.href).pathname;
    const cachedShell = () =>
      caches
        .match('index.html')
        .then((cached) => cached || caches.match('./'))
        .then((cached) => cached || Response.error());

    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!isCacheable(response)) return cachedShell();
          // Only the app shell may replace the cached shell — never some
          // other same-origin page the user happened to navigate to.
          if (url.pathname === shellPath || url.pathname === indexPath) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('index.html', copy));
          }
          return response;
        })
        .catch(cachedShell)
    );
    return;
  }

  // Static assets: serve from cache immediately and refresh in the
  // background (stale-while-revalidate). Falls back to the network on a
  // first visit or a cache miss.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (isCacheable(response)) {
            const copy = response.clone();
            const key = url.origin + url.pathname;
            caches.open(CACHE_NAME).then((cache) => cache.put(key, copy));
          }
          return response;
        })
        .catch(() => cached || Response.error());
      return cached || network;
    })
  );
});
