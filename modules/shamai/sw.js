const VERSION = 'shamai-v3.0.0';
const STATIC_CACHE = `static-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;

const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './src/core.js',
  './src/calc.js',
  './src/dashboard.js',
  './src/appraise-metals.js',
  './src/appraise-gems.js',
  './src/appraise-judaica.js',
  './src/appraise-other.js',
  './src/ledger.js',
  './src/tools.js',
  './src/navigation.js',
  './src/appraise-assets.js',
  './src/analytics.js',
  './src/misc.js',
  './src/appraise-luxury.js',
  './src/widgets.js',
  './src/report.js',
  './src/opp-extras.js',
  './src/contacts.js',
  './src/inventory.js',
  './src/ocr-prices.js',
  './src/authenticity.js',
  './manifest.json',
  './favicon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './lib/qrcode.js',
  './lib/lz-string.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(STATIC_CACHE).then(c => c.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => ![STATIC_CACHE, RUNTIME_CACHE].includes(k)).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API requests: network-first, cache fallback
  if (url.host.includes('gold-api.com') ||
      url.host.includes('frankfurter.app') ||
      url.host.includes('coingecko.com') ||
      url.host.includes('boi.org.il')) {
    e.respondWith(
      fetch(request)
        .then(r => {
          const copy = r.clone();
          caches.open(RUNTIME_CACHE).then(c => c.put(request, copy));
          return r;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Static assets: cache-first
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(r => {
          if (r.ok && r.type === 'basic') {
            const copy = r.clone();
            caches.open(STATIC_CACHE).then(c => c.put(request, copy));
          }
          return r;
        });
      })
    );
    return;
  }

  // אין יותר בקשות גופן חיצוניות — הגופנים מגיעים מהמקום המקומי.
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
