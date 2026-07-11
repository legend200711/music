/* ═══════════════════════════════════════════════════════
   DODGE DASH LEGENDS — Service Worker
   Cache-first for game shell + assets
   Network-only for CDN scripts (Three.js)
   Offline fallback page when no connection
   ═══════════════════════════════════════════════════════ */

const CACHE  = 'ddl-v1';
const SHELL  = [
  '/dodge-dash-legends.html',
  '/ddl-manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/icon-96.png',
  '/icons/icon-144.png'
];

/* Hosts that must always come from the network */
const NET_ONLY = [
  'cdnjs.cloudflare.com',
  'firebaseapp.com',
  'googleapis.com',
  'gstatic.com',
  'firebaseio.com'
];

/* ── Install: pre-cache game shell ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.allSettled(
        SHELL.map(url =>
          cache.add(url).catch(err =>
            console.warn('[DDL-SW] Pre-cache skipped:', url, err.message)
          )
        )
      )
    ).then(() => {
      console.log('[DDL-SW] Installed.');
      return self.skipWaiting();
    })
  );
});

/* ── Activate: wipe old caches ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE).map(k => {
          console.log('[DDL-SW] Removing old cache:', k);
          return caches.delete(k);
        })
      )
    ).then(() => {
      console.log('[DDL-SW] Activated.');
      return self.clients.claim();
    })
  );
});

/* ── Message: SKIP_WAITING for instant updates ── */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* ── Fetch ── */
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  let url;
  try { url = new URL(event.request.url); } catch (_) { return; }

  /* 1. Always network for CDN / Firebase */
  if (NET_ONLY.some(h => url.hostname.includes(h))) return;

  /* 2. Game HTML + manifest + icons → cache-first, revalidate in bg */
  const isShell =
    url.pathname === '/' ||
    url.pathname === '/dodge-dash-legends.html' ||
    url.pathname === '/ddl-manifest.json' ||
    url.pathname.startsWith('/icons/');

  if (isShell) {
    event.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          /* Revalidate in background */
          const fresh = fetch(event.request).then(res => {
            if (res && res.status === 200 && res.type !== 'opaque') {
              cache.put(event.request, res.clone());
            }
            return res;
          }).catch(() => null);
          return cached || fresh;
        })
      )
    );
    return;
  }

  /* 3. Navigation → serve game HTML, fall back to inline offline page */
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match('/dodge-dash-legends.html').then(cached => cached || new Response(
          `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <title>Dodge Dash — Offline</title>
          <style>
            body{margin:0;background:#0a0a0f;color:#fff;font-family:sans-serif;
                 display:flex;align-items:center;justify-content:center;
                 min-height:100vh;flex-direction:column;gap:16px;text-align:center;padding:24px;}
            h1{background:linear-gradient(135deg,#7c4dff,#e040fb);-webkit-background-clip:text;
               -webkit-text-fill-color:transparent;background-clip:text;font-size:22px;margin:0;}
            p{color:#666;font-size:14px;margin:0;}
            button{background:linear-gradient(135deg,#7c4dff,#e040fb);border:none;border-radius:8px;
                   color:#fff;padding:12px 28px;font-size:14px;cursor:pointer;}
          </style></head>
          <body>
            <div style="font-size:56px">🏎️</div>
            <h1>You're offline</h1>
            <p>Dodge Dash Legends needs a connection to load.<br>Check your network and try again.</p>
            <button onclick="location.reload()">Try Again</button>
          </body></html>`,
          { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        ))
      )
    );
    return;
  }

  /* 4. Everything else: network-first, cache fallback */
  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res && res.status === 200 && res.type !== 'opaque' &&
            url.origin === self.location.origin) {
          caches.open(CACHE).then(c => c.put(event.request, res.clone()));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
