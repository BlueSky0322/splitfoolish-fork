// Keeps the app's built files so it starts fast and installs as an app. Built files
// have content hashes in their names, so a cached copy is never out of date. Pages and
// /api are never touched: they always go to the network, through Cloudflare Access.
const CACHE = 'splitfoolish-assets-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    !url.pathname.startsWith('/assets/')
  ) {
    return;
  }
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      // Only real files: a sign-in redirect must not be stored as an asset
      if (response.ok && response.type === 'basic') cache.put(event.request, response.clone());
      return response;
    }),
  );
});
