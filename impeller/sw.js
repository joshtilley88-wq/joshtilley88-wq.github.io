/* Impeller Quoter service worker: offline app shell.
 * Only GET requests to this site and the pdf.js CDN are cached.
 * OpenAI API calls (POST) are never intercepted or cached. */
const C = 'impeller-quoter-v2';
const F = ['./', './index.html', './app.css', './manifest.json', './icon-192.png', './icon-512.png', './icon-maskable-512.png',
  './js/defaults.js', './js/engine.js', './js/ai.js', './js/app.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(F))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  const same = url.origin === self.location.origin, cdn = url.hostname === 'cdnjs.cloudflare.com';
  if (!same && !cdn) return;
  if (cdn) { // versioned library: cache first
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { const c = r.clone(); caches.open(C).then(x => x.put(req, c)); return r; })));
    return;
  }
  e.respondWith(fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(C).then(x => x.put(req, c)); } return r; })
    .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
});
