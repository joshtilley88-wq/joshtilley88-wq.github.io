/* Invoicing service worker: offline app shell. Network-first for site files.
 * Bump C on every deploy. All user data lives in IndexedDB, never here. */
const C = 'invoicing-v1';
const F = ['./', './index.html', './app.css', './manifest.json', './icon-192.png', './icon-512.png', './icon-maskable-512.png',
  './fonts/inter-latin-wght.woff2', './js/vendor/chart.umd.min.js', './js/util.js', './js/db.js', './js/views.js', './js/tools.js', './js/app.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(F))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x.startsWith('invoicing-') && x !== C).map(x => caches.delete(x))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.includes('/invoicing/')) return;
  e.respondWith(fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(C).then(x => x.put(req, c)); } return r; })
    .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
});
