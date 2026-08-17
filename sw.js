// ═══════════════════════════════════════════════════════
// sw.js — Service Worker v12.1
// Network-first for all app files — changes show immediately.
// Bump CACHE_VERSION when you deploy to force a full cache bust.
// ═══════════════════════════════════════════════════════

const CACHE_VERSION = 'forge-v12-3';
const CACHE_NAME    = CACHE_VERSION;

const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './sound.js',
  './timer.js',
  './xp.js',
  './storage.js',
  './firebase.js',
  './calendar.js',
  './plan.js',
  './manifest.json'
];

// ── Install: pre-cache everything ──────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      for (const file of APP_FILES) {
        try { await cache.add(file); }
        catch (e) { console.warn('FORGE SW: failed to cache', file, e.message); }
      }
    })
  );
  // Take over immediately — don't wait for old SW to idle
  self.skipWaiting();
});

// ── Activate: nuke every old cache version ─────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => {
        console.log('FORGE SW: deleting old cache', k);
        return caches.delete(k);
      }))
    )
  );
  self.clients.claim();
});

// ── Fetch strategy ──────────────────────────────────────
// External (Firebase, Google APIs) → always bypass SW
// App files (JS, CSS, HTML)        → network-first, cache fallback
// Everything else                  → cache-first, background update

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = req.url;

  // 1. Always bypass for external services
  if (url.includes('firestore.googleapis.com') ||
      url.includes('firebase')                 ||
      url.includes('googleapis')               ||
      url.includes('gstatic')) {
    return;
  }

  // 2. Network-first for all app files (HTML, JS, CSS, JSON)
  const isAppFile = APP_FILES.some(f => url.endsWith(f.replace('./', '/')))
    || url.endsWith('/')
    || /\.(html|js|css|json)$/.test(url);

  if (isAppFile) {
    event.respondWith(networkFirst(req));
    return;
  }

  // 3. Cache-first with background update for everything else (icons, etc.)
  event.respondWith(cacheFirstWithUpdate(req));
});

// Network-first: try network, update cache, fall back to cache if offline
async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && res.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, res.clone());
    }
    return res;
  } catch (_) {
    const cached = await caches.match(req);
    return cached || new Response('Offline', { status: 503 });
  }
}

// Cache-first: serve from cache, silently refresh in background
async function cacheFirstWithUpdate(req) {
  const cached = await caches.match(req);
  const fetchPromise = fetch(req).then(res => {
    if (res && res.status === 200) {
      caches.open(CACHE_NAME).then(cache => cache.put(req, res.clone()));
    }
    return res;
  }).catch(() => {});

  return cached || fetchPromise;
}
