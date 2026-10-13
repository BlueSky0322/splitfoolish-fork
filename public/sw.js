// Keeps the app's built files and images on the device so it starts fast, installs
// as an app, and doesn't download pictures again. Everything kept here never changes:
// built files have content hashes in their names, a profile picture URL names its
// version, and a photo never changes once added. Pages and the rest of /api always
// go to the network, through Cloudflare Access.
const ASSETS = 'splitfoolish-assets-v1';
const IMAGES = 'splitfoolish-images-v1';
const KEEP = [ASSETS, IMAGES];

// Profile pictures (always with ?v=) and photos of splits and receipts
const isImage = (url) =>
  (url.pathname.startsWith('/api/avatars/') && url.searchParams.has('v')) ||
  /^\/api\/splits\/[^/]+\/(attachments\/[^/]+|picture)$/.test(url.pathname);

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(cacheName, request, accept) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // Only real files: a sign-in redirect or an error must not be stored
  if (response.ok && response.type === 'basic' && accept(response)) {
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(ASSETS, event.request, () => true));
  } else if (isImage(url)) {
    event.respondWith(
      cacheFirst(IMAGES, event.request, (r) =>
        (r.headers.get('Content-Type') ?? '').startsWith('image/'),
      ),
    );
  }
});
