// Keeps the app on the device so it starts fast, opens offline, installs as an app,
// and doesn't download pictures or fonts again:
// - The page itself comes from the network when there is one, and from the copy kept
//   here when there isn't, so the app opens offline.
// - Built files, fonts and images never change once made (built files have content
//   hashes in their names, a profile picture URL names its version, a photo never
//   changes once added, and a changed font in /fonts gets a new name), so they're
//   served from here once kept.
// - The rest of /api always goes to the network, through Cloudflare Access.
// - Changes made offline are kept by the app (in IndexedDB); background sync sends
//   them here when the connection is back, even if the app is closed.
const SHELL = 'splitfoolish-shell-v1';
const ASSETS = 'splitfoolish-assets-v1';
/** IMAGE_CACHE in web/src/offline/cache.ts, which clears it on sign-out */
const IMAGE_CACHE = 'splitfoolish-images-v1';
const FONTS = 'splitfoolish-fonts-v1';
const KEEP = [SHELL, ASSETS, IMAGE_CACHE, FONTS];

// Shared with the app, which can't be imported here: keep each the same as its twin
/** SYNC_TAG in web/src/offline/outbox.ts */
const SYNC_TAG = 'sf-outbox';
/** OUTBOX_PREFIX and LOCK_PREFIX in web/src/offline/outbox.ts; CREATE_PREFIX in pending-creates.ts */
const OUTBOX_PREFIX = 'outbox:';
const CREATE_PREFIX = 'create:';
const LOCK_PREFIX = 'sf-outbox:';
/** SW_USER_KEY in web/src/offline/cache.ts; entries there are { email, value } */
const USER_KEY = 'sf-user';
/** CLIENT_ID_HEADER in shared/api.ts */
const CLIENT_ID_HEADER = 'X-Client-Id';
/** MAX_CHANGES in shared/api.ts: the most changes the server takes in one request */
const MAX_CHANGES = 200;

// Profile pictures and payment QR codes (always with ?v=), and photos of splits and receipts
const isImage = (url) =>
  ((url.pathname.startsWith('/api/avatars/') || url.pathname.startsWith('/api/payment-qr/')) &&
    url.searchParams.has('v')) ||
  /^\/api\/splits\/[^/]+\/(attachments\/[^/]+|picture)$/.test(url.pathname);

const isFont = (url) =>
  url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com';

/** A font file, not the app's page sent in its place for an address it doesn't have */
const isFontFile = (response) =>
  /^(font\/|application\/(font|x-font|octet-stream))/.test(
    response.headers.get('Content-Type') ?? '',
  );

/** A real page, not a sign-in redirect or an error */
const isPage = (response) =>
  response.ok &&
  response.type === 'basic' &&
  !response.redirected &&
  (response.headers.get('Content-Type') ?? '').startsWith('text/html');

/** Keeps the page and the built files it starts with, so the app opens offline */
async function keepShell(response) {
  const html = await response.clone().text();
  const shell = await caches.open(SHELL);
  await shell.put('/', response.clone());
  const assets = await caches.open(ASSETS);
  const files = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  await Promise.all(
    files.map(async (file) => {
      if (await assets.match(file)) return;
      const res = await fetch(file);
      if (res.ok && res.type === 'basic') await assets.put(file, res);
    }),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    fetch('/')
      .then((res) => (isPage(res) ? keepShell(res) : undefined))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

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
  if (response.ok && accept(response)) cache.put(request, response.clone());
  return response;
}

async function page(event) {
  try {
    const response = await fetch(event.request);
    if (isPage(response)) event.waitUntil(keepShell(response).catch(() => undefined));
    return response;
  } catch (err) {
    // Offline: the app is the same page whatever the address
    const cached = await caches.match('/', { cacheName: SHELL });
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  if (isFont(url)) {
    event.respondWith(
      cacheFirst(FONTS, event.request, (r) => r.type === 'cors' || r.type === 'basic'),
    );
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(page(event));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(ASSETS, event.request, (r) => r.type === 'basic'));
  } else if (url.pathname.startsWith('/fonts/')) {
    // The PDF export's font, so a PDF can be made offline once one has been made
    event.respondWith(cacheFirst(FONTS, event.request, (r) => r.type === 'basic' && isFontFile(r)));
  } else if (isImage(url)) {
    event.respondWith(
      cacheFirst(
        IMAGE_CACHE,
        event.request,
        (r) => r.type === 'basic' && (r.headers.get('Content-Type') ?? '').startsWith('image/'),
      ),
    );
  }
});

// --- Background sync: sends what the app kept while offline ---------------------------

// idb-keyval's database, where the app keeps its saved copies and unsent changes
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('keyval-store');
    req.onupgradeneeded = () => req.result.createObjectStore('keyval');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idb(db, mode, run) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('keyval', mode);
    const req = run(tx.objectStore('keyval'));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

/** The same lock the app takes, so a change is never sent twice */
const withLock = (id, fn) =>
  self.navigator.locks ? self.navigator.locks.request(`${LOCK_PREFIX}${id}`, fn) : fn();

class TryLater extends Error {}

async function post(path, body) {
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [CLIENT_ID_HEADER]: 'background-sync' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new TryLater('No connection');
  }
  // The same rule as isRetryable in web/src/offline/outbox.ts: busy, a problem on the
  // server's side, or signed out. Nothing wrong with what was sent.
  if (res.status === 401 || res.status === 429 || res.status >= 500) {
    throw new TryLater(`HTTP ${res.status}`);
  }
  // Signed out (Cloudflare Access sends a sign-in page): the app sends it once signed in
  if (res.redirected || res.type === 'opaqueredirect') throw new TryLater('Signed out');
  // Answered by something other than the API (a proxy, say), as the app sees it too:
  // anything that isn't JSON, or is JSON null
  if (res.ok && (await res.json().catch(() => null)) == null) {
    throw new TryLater('Not answered with JSON');
  }
  // Otherwise done; a refusal (4xx) is dropped, and the app shows the split as the
  // server has it
  return res;
}

async function flushOfflineChanges() {
  const db = await openDb();
  try {
    const user = await idb(db, 'readonly', (s) => s.get(USER_KEY));
    const keys = await idb(db, 'readonly', (s) => s.getAllKeys());
    const mine = (entry) => entry != null && user != null && entry.email === user;
    const read = (key) => idb(db, 'readonly', (s) => s.get(key));
    const drop = (key) => idb(db, 'readwrite', (s) => s.delete(key));

    // New splits first, so their changes have somewhere to go
    for (const key of keys.filter((k) => typeof k === 'string' && k.startsWith(CREATE_PREFIX))) {
      const id = key.slice(CREATE_PREFIX.length);
      await withLock(id, async () => {
        const entry = await read(key);
        if (!mine(entry)) return;
        const { name, currency } = entry.value;
        await post('/api/splits', { id, name, currency });
        await drop(key);
      });
    }

    for (const key of keys.filter((k) => typeof k === 'string' && k.startsWith(OUTBOX_PREFIX))) {
      const id = key.slice(OUTBOX_PREFIX.length);
      await withLock(id, async () => {
        const entry = await read(key);
        if (!mine(entry) || entry.value.length === 0) return;
        // In order, as many at a time as the server takes. Each request's changes are
        // crossed off once saved, so a failure later on leaves only what wasn't sent.
        let left = entry.value;
        while (left.length > 0) {
          const batch = left.slice(0, MAX_CHANGES);
          const res = await post(`/api/splits/${encodeURIComponent(id)}/changes`, {
            changes: batch.map((q) => q.change),
          });
          // Refused: the rest was built on top of it, so it goes too
          left = res.ok ? left.slice(batch.length) : [];
          if (left.length > 0) {
            const now = left;
            await idb(db, 'readwrite', (s) => s.put({ ...entry, value: now }, key));
          }
        }
        await drop(key);
      });
    }
  } finally {
    db.close();
  }
}

self.addEventListener('sync', (event) => {
  // Failing makes the browser try again later
  if (event.tag === SYNC_TAG) event.waitUntil(flushOfflineChanges());
});
