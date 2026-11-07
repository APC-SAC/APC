const APP_CACHE = 'apc-inventario-app-v17';
const CDN_CACHE = 'apc-inventario-cdn-v17';
const SHELL = [
  '/APC/', '/APC/index.html', '/APC/apc-logo.png', '/APC/manifest.webmanifest',
  '/APC/assets/styles.css?v=17', '/APC/assets/main.js?v=17', '/APC/assets/react/ContentEditor.js', '/APC/assets/qr-pdf.js', '/APC/assets/qr-core.js', '/APC/assets/images/tapas-rey.jpg', '/APC/version.json'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(APP_CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => ![APP_CACHE, CDN_CACHE].includes(key)).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.hostname.endsWith('supabase.co')) return;
  const isApp = url.origin === self.location.origin;
  const isCdn = url.hostname === 'esm.sh' || url.hostname.endsWith('.esm.sh');
  if (!isApp && !isCdn) return;
  event.respondWith((async () => {
    const cache = await caches.open(isApp ? APP_CACHE : CDN_CACHE);
    const cached = await cache.match(request);
    if (cached && !isApp) return cached;
    try {
      const response = await fetch(request);
      if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone()).catch(() => undefined);
      return response;
    } catch (error) {
      if (cached) return cached;
      if (isApp && request.mode === 'navigate') {
        const fallback = await cache.match('/APC/index.html');
        if (fallback) return fallback;
      }
      throw error;
    }
  })());
});
