/* InvoiceMate service worker (based on Allyce's). App shell: network-first with cache fallback, so updates show up.
 * Vendor files (Chart.js, Tesseract OCR engine + English data): cache-first, they never change. Bump C on every deploy.
 * All user data lives in IndexedDB / localStorage, never here. */
const C = 'invoicemate-v4';
const SHELL = ['./', './index.html', './app.css', './im.css', './manifest.json', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/logo.svg', './icons/mark.svg',
  './fonts/inter-latin-wght.woff2', './js/config.js', './js/util.js', './js/local-only.js', './js/db.js', './js/views.js', './js/tools.js', './js/backup.js',
  './js/parser.js', './js/receipt.js', './js/thinking.js', './js/send.js', './js/chase-core.js', './js/chase.js', './view.html', './js/view.js', './js/convo.js', './js/voice.js', './js/talk.js', './js/scan.js', './js/clean.js', './js/app.js'];
const VENDOR = ['./vendor/chart.umd.min.js', './vendor/tesseract/tesseract.min.js', './vendor/tesseract/worker.min.js', './vendor/tesseract/lang/eng.traineddata.gz',
  './vendor/tesseract/tesseract-core-relaxedsimd-lstm.wasm.js'];   // the other two core builds (simd / plain) are cached the first time a phone needs one
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL.concat(VENDOR)))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x.startsWith('invoicemate-') && x !== C).map(x => caches.delete(x))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url), scope = new URL(self.registration.scope);
  if (req.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(scope.pathname)) return;
  if (url.pathname.includes('/vendor/')) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req).then(res => { if (res.ok) { const c = res.clone(); caches.open(C).then(x => x.put(req, c)); } return res; })));
    return;
  }
  e.respondWith(fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(C).then(x => x.put(req, c)); } return r; })
    .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
});
/* tapping an "emails due" notification opens (or focuses) the app on the email outbox */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || new URL('./#/outbox', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    const w = ws.find(c => new URL(c.url).pathname.startsWith(new URL(self.registration.scope).pathname));
    if (w) { w.postMessage({ go: 'outbox' }); return w.focus(); }
    return self.clients.openWindow(url);
  }));
});
