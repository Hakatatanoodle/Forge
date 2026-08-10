// ═══════════════════════════════════════════════════════
// sw.js — Service Worker v11.7 (fixed)
// Robust install, no external font fails, relative paths
// ═══════════════════════════════════════════════════════

const CACHE_NAME = 'forge-v11-7';

const FILES_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './sound.js',
  './timer.js',
  './xp.js',
  './storage.js',
  './firebase.js',
  './manifest.json'
];

// Install: cache everything, but don't fail if one file fails
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      for (const file of FILES_TO_CACHE) {
        try {
          await cache.add(file);
        } catch (e) {
          console.warn('FORGE SW: failed to cache', file, e.message);
        }
      }
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch: HTML network-first, everything else cache-first with network fallback
self.addEventListener('fetch', event => {
  const req = event.request;
  // Skip Firebase / external APIs — never cache
  if (req.url.includes('firestore.googleapis.com') ||
      req.url.includes('firebase') ||
      req.url.includes('googleapis') ||
      req.url.includes('gstatic')) {
    return; // let browser handle
  }

  // HTML — network first
  if (req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Others — cache first, then network
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) {
        // update in background
        fetch(req).then(res => {
          if (res && res.status === 200) {
            caches.open(CACHE_NAME).then(cache => cache.put(req, res.clone()));
          }
        }).catch(()=>{});
        return cached;
      }
      return fetch(req).then(res => {
        if (res && res.status === 200) {
          caches.open(CACHE_NAME).then(cache => cache.put(req, res.clone()));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
