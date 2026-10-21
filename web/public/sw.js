// Keeps the app on the device so it starts fast, opens offline, installs as an app,
// and doesn't download pictures or fonts again:
// - The page itself comes from the network when it answers within a few seconds, and
//   from the copy kept here when it doesn't, fails, or the server is in trouble, so the
//   app opens offline and on a bad connection. When Cloudflare Access asks to sign in
//   again, the kept page opens too, marked so, and the app offers to sign in: that page
//   load (marked with SIGN_IN_PARAM) and Access's own pages are left to the network.
// - The kept page is only replaced once every built file it needs is kept too, along
//   with what the app offers offline but loads later (sharing an image, exporting), as
//   the build lists them in /precache.json. Built files of the newest two versions are
//   kept, so a tab still open on the older one can load what it needs; older ones go.
// - Built files and fonts never change once made (built files have content hashes in
//   their names, and a changed font in /fonts gets a new name), so they're served from
//   here once kept.
// - Pictures and photos are private: online they always come from the server, which
//   checks the viewer may still see them (the browser's own copy answers when the
//   server says it's unchanged). Each is kept for the account it was shown to, and
//   shown from here only offline, or while the server is failing, and only to that
//   account.
// - The rest of /api always goes to the network, through Cloudflare Access.
// - Changes and photos made offline are kept by the app (in IndexedDB); background sync
//   sends them here when the connection is back, even if the app is closed.
const SHELL = 'splitfoolish-shell-v1';
const ASSETS = 'splitfoolish-assets-v1';
/**
 * IMAGE_CACHE_PREFIX in web/src/offline/cache.ts, which clears them on sign-out: one
 * cache per account, named with its email
 */
const IMAGE_CACHE_PREFIX = 'splitfoolish-images-v2:';
/** IMAGE_VIEWER_HEADER in shared/api.ts: whose a picture is, as the server sent it */
const IMAGE_VIEWER_HEADER = 'X-Image-Viewer';
const FONTS = 'splitfoolish-fonts-v1';
const KEEP = [SHELL, ASSETS, FONTS];

/** Every built file the app needs offline, written by the build (web/build/precache.ts) */
const PRECACHE_LIST = '/precache.json';
/** Kept in SHELL beside the page: which built files it and the page before it need */
const SHELL_FILES = '/shell-files';
/** How long a page may take to come before the kept one is shown instead */
const PAGE_WAIT_MS = 3000;

// Shared with the app, which can't be imported here: keep each the same as its twin
/** OPENED_FROM_DEVICE in web/src/offline/cache.ts */
const OPENED_FROM_DEVICE = 'sf-opened-from-device';
/** OPENED_SIGNED_OUT in web/src/offline/cache.ts: opened from here because Access asked to sign in */
const SIGNED_OUT = 'signed-out';
/** SIGN_IN_PARAM in web/src/offline/cache.ts: a page load going to sign in, left to the browser */
const SIGN_IN_PARAM = 'sign-in';
/** SYNC_TAG in web/src/offline/outbox.ts */
const SYNC_TAG = 'sf-outbox';
/** OUTBOX_PREFIX and LOCK_PREFIX in web/src/offline/outbox.ts; CREATE_PREFIX in pending-creates.ts */
const OUTBOX_PREFIX = 'outbox:';
const CREATE_PREFIX = 'create:';
const LOCK_PREFIX = 'sf-outbox:';
/** SW_USER_KEY in web/src/offline/cache.ts; entries there are { email, value } */
const USER_KEY = 'sf-user';
/**
 * PHOTO_PREFIX in web/src/offline/photo-queue.ts; entries there are { email, value } with
 * value { id, splitId, itemId, createdAt, type, bytes }
 */
const PHOTO_PREFIX = 'photo:';
/** The lock photo-queue.ts takes for a photo while sending it */
const PHOTO_LOCK_PREFIX = 'sf-photo:';
/** CLIENT_ID_HEADER in shared/api.ts */
const CLIENT_ID_HEADER = 'X-Client-Id';
// Whose a write is (EXPECTED_ACCOUNT_HEADER in shared/api.ts): the account it was kept for
const EXPECTED_ACCOUNT_HEADER = 'X-Expected-Account';
/** PHOTO_ID_PARAM in shared/api.ts: a photo sent again with its id isn't added twice */
const PHOTO_ID_PARAM = 'id';
/** MAX_CHANGES and MAX_CHANGES_BYTES in shared/api.ts: how much one request may carry */
const MAX_CHANGES = 200;
const MAX_CHANGES_BYTES = 48 * 1024;

const utf8 = new TextEncoder();

/** The next request's changes, as nextBatch in web/src/offline/outbox.ts picks them */
function nextBatch(queued) {
  let bytes = utf8.encode('{"changes":[],"ids":[],"currencies":[]}').length;
  let count = 0;
  for (const q of queued.slice(0, MAX_CHANGES)) {
    bytes +=
      utf8.encode(JSON.stringify([q.change, q.cid, q.currency ?? null])).length -
      2 +
      (count > 0 ? 3 : 0);
    if (count > 0 && bytes > MAX_CHANGES_BYTES) break;
    count++;
  }
  return queued.slice(0, count);
}

/** What's sent for these changes, as changesBody in web/src/offline/outbox.ts makes it */
function changesBody(batch) {
  const currencies = batch.map((q) => q.currency);
  return {
    changes: batch.map((q) => q.change),
    ids: batch.map((q) => q.cid),
    ...(currencies.every((c) => c != null) && { currencies }),
  };
}

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

/**
 * The server, or something in the way, failing to send the page: better shown the kept
 * one. A sign-in redirect or a refusal (4xx) still goes to the browser, so Access can
 * ask them to sign in again.
 */
const isBroken = (response) =>
  response.status >= 500 ||
  (response.ok &&
    !response.redirected &&
    !(response.headers.get('Content-Type') ?? '').startsWith('text/html'));

/** The built files a page loads as it starts */
const filesOf = (html) => [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);

const sameFiles = (a, b) => a.length === b.length && a.every((file) => b.includes(file));

/** A built file, not a sign-in page or an error sent in its place */
async function fetchFile(file) {
  const res = await fetch(file);
  if (!res.ok || res.type !== 'basic' || res.redirected) {
    throw new Error(`${file} could not be kept (${res.status})`);
  }
  return res;
}

/**
 * The build's list of every built file the app needs offline, or null when this build
 * has none (one from before there was a list). Not reaching it fails, to try again later.
 */
async function precacheList() {
  const res = await fetch(PRECACHE_LIST, { cache: 'no-cache' });
  if (res.status >= 500 || res.redirected || res.type !== 'basic') {
    throw new Error(`The list of files could not be read (${res.status})`);
  }
  const list = res.ok ? await res.json().catch(() => null) : null;
  return Array.isArray(list) && list.every((f) => typeof f === 'string') ? list : null;
}

/** Which built files the kept page and the one before it need, as kept beside it */
async function readRecord(shell) {
  const record = await shell
    .match(SHELL_FILES)
    .then((r) => r?.json())
    .catch(() => null);
  return ['page', 'files', 'previous'].every((key) => Array.isArray(record?.[key])) ? record : null;
}

/**
 * Keeps a page that came from the network, with every built file it needs. The page
 * kept before stays until all of them are kept, so stopping halfway (the connection
 * dropping, the browser closing the worker) still leaves a page that opens offline.
 */
async function secureShell(response) {
  const html = await response.clone().text();
  const shell = await caches.open(SHELL);
  const assets = await caches.open(ASSETS);
  const page = filesOf(html);
  const kept = await shell.match('/');
  const keptHtml = kept ? await kept.text() : null;
  const record = await readRecord(shell);
  // Kept already, with its files
  if (keptHtml === html && record != null && sameFiles(record.page, page)) return;

  const list = await precacheList();
  // A list from another version (a deploy landing in between): try again next time
  if (list != null && !page.every((file) => list.includes(file))) {
    throw new Error('The page and the list of its files are from different versions');
  }
  const files = list ?? page;
  await Promise.all(
    files.map(async (file) => {
      if (!(await assets.match(file))) await assets.put(file, await fetchFile(file));
    }),
  );

  // What the page kept until now needs, for tabs still open on it
  let previous = keptHtml == null ? [] : filesOf(keptHtml);
  if (record != null) previous = sameFiles(record.page, page) ? record.previous : record.files;
  await shell.put('/', response);
  await shell.put(
    SHELL_FILES,
    new Response(JSON.stringify({ page, files, previous }), {
      headers: { 'Content-Type': 'application/json' },
    }),
  );

  // Built files neither version needs: from older versions, or fetched along the way
  const wanted = new Set([...files, ...previous]);
  for (const request of await assets.keys()) {
    if (!wanted.has(new URL(request.url).pathname)) await assets.delete(request);
  }
}

// One page at a time, so two tabs opening at once don't interleave their updates
let keeping = Promise.resolve();
/** Keeps the page (a response no one else reads) and its files, after any being kept */
function keepShell(response) {
  const done = keeping.then(() => secureShell(response));
  keeping = done.catch(() => undefined);
  return done;
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
        Promise.all(
          keys
            .filter((k) => !KEEP.includes(k) && !k.startsWith(IMAGE_CACHE_PREFIX))
            .map((k) => caches.delete(k)),
        ),
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

/** Who the app last said is signed in (USER_KEY), or null */
async function signedInAccount() {
  const db = await openDb();
  try {
    return (await idb(db, 'readonly', (s) => s.get(USER_KEY))) ?? null;
  } finally {
    db.close();
  }
}

/** This account's copy of a picture, if it was shown one */
async function keptImage(request) {
  const account = await signedInAccount().catch(() => null);
  const name = account == null ? null : `${IMAGE_CACHE_PREFIX}${account}`;
  if (name == null || !(await caches.has(name))) return undefined;
  return (await caches.open(name)).match(request);
}

/** Forgets every account's copy of a picture the server no longer shows */
async function forgetImage(request) {
  const names = (await caches.keys()).filter((k) => k.startsWith(IMAGE_CACHE_PREFIX));
  await Promise.all(names.map(async (name) => (await caches.open(name)).delete(request)));
}

/**
 * A picture or photo from the server, so access taken away, or another account signed
 * in, is checked each time; the kept copy only when the server can't be reached or is
 * failing, and only the signed-in account's. A sign-in page in its place shows nothing.
 */
async function image(event) {
  const { request } = event;
  let response;
  try {
    // Checked with the server even when the browser holds a copy older builds said to
    // keep for a year
    response = await fetch(request, { cache: 'no-cache' });
  } catch (err) {
    const kept = await keptImage(request);
    if (kept) return kept;
    throw err;
  }
  if (response.status >= 500) return (await keptImage(request)) ?? response;
  const viewer = response.headers.get(IMAGE_VIEWER_HEADER);
  if (
    response.ok &&
    response.type === 'basic' &&
    viewer != null &&
    (response.headers.get('Content-Type') ?? '').startsWith('image/')
  ) {
    const copy = response.clone();
    event.waitUntil(
      caches.open(`${IMAGE_CACHE_PREFIX}${viewer}`).then((c) => c.put(request, copy)),
    );
  } else if (response.status === 403 || response.status === 404) {
    // Removed, or no longer this person's to see
    event.waitUntil(forgetImage(request));
  }
  return response;
}

/**
 * The kept page, marked so the app knows it opened without the server and doesn't wait
 * long on it (openedFromDevice in web/src/offline/cache.ts)
 */
async function fromDevice(kept, why = 'true') {
  const html = (await kept.text()).replace(
    /<head[^>]*>/i,
    (head) => `${head}<meta name="${OPENED_FROM_DEVICE}" content="${why}">`,
  );
  const headers = new Headers(kept.headers);
  headers.delete('Content-Length');
  return new Response(html, { status: kept.status, statusText: kept.statusText, headers });
}

const wait = (ms) => new Promise((resolve) => setTimeout(() => resolve(null), ms));

function page(event) {
  const network = fetch(event.request);
  // A good page is kept, even one that comes too late to be shown. Copied here, first,
  // before the browser reads it.
  event.waitUntil(
    network.then((res) => (isPage(res) ? keepShell(res.clone()) : undefined)).catch(() => {}),
  );
  return pageOrKept(network);
}

async function pageOrKept(network) {
  const kept = await (await caches.open(SHELL)).match('/');
  // Nothing kept yet: whatever the network says, however long it takes
  if (kept == null) return network;
  // Offline, slow, or the server failing: the app is the same page whatever the address
  const answer = await Promise.race([network, wait(PAGE_WAIT_MS)]).catch(() => null);
  // Cloudflare Access wants them to sign in again: the app opens with what it kept, and
  // offers to sign in, rather than nothing until there's a connection good enough to
  if (answer != null && answer.type === 'opaqueredirect') return fromDevice(kept, SIGNED_OUT);
  return answer != null && !isBroken(answer) ? answer : fromDevice(kept);
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
  // Signing in and out with Cloudflare Access, and connecting an agent (the OAuth pages
  // and MCP, worker/mcp/oauth.ts), are left to the browser: never the app's kept page
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/cdn-cgi/') ||
    url.pathname.startsWith('/oauth/') ||
    url.pathname.startsWith('/.well-known/') ||
    url.pathname === '/mcp' ||
    url.pathname.startsWith('/mcp/')
  ) {
    return;
  }

  if (event.request.mode === 'navigate') {
    // Going to sign in: Access answers, never the kept page
    if (url.searchParams.has(SIGN_IN_PARAM)) return;
    event.respondWith(page(event));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(ASSETS, event.request, (r) => r.type === 'basic'));
  } else if (url.pathname.startsWith('/fonts/')) {
    // The PDF export's font, so a PDF can be made offline once one has been made
    event.respondWith(cacheFirst(FONTS, event.request, (r) => r.type === 'basic' && isFontFile(r)));
  } else if (isImage(url)) {
    event.respondWith(image(event));
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

/** The same lock the app takes, so a change (or a photo) is never sent twice */
const withLock = (id, fn, prefix = LOCK_PREFIX) =>
  self.navigator.locks ? self.navigator.locks.request(`${prefix}${id}`, fn) : fn();

class TryLater extends Error {}

/** Sends JSON, or a photo (a Blob, as its own type) */
/** Sends what `account` kept: the server refuses it if someone else is signed in now */
async function post(path, body, account) {
  const photo = body instanceof Blob;
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': photo ? body.type || 'image/jpeg' : 'application/json',
        [CLIENT_ID_HEADER]: 'background-sync',
        [EXPECTED_ACCOUNT_HEADER]: account,
      },
      body: photo ? body : JSON.stringify(body),
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
  // Made as another account than the one signed in now: kept for that account, as
  // isOtherAccount in web/src/offline/outbox.ts says
  if (res.status === 409) {
    const answer = await res
      .clone()
      .json()
      .catch(() => null);
    if (answer?.code === 'account_mismatch') throw new TryLater('Signed in as someone else');
  }
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
        await post('/api/splits', { id, name, currency }, entry.email);
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
          const batch = nextBatch(left);
          const res = await post(
            `/api/splits/${encodeURIComponent(id)}/changes`,
            changesBody(batch),
            entry.email,
          );
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

    // Photos last, so their split and their receipt's item are saved first; oldest first,
    // one at a time. Each is read again under its lock, in case the app sent it meanwhile.
    const photos = [];
    for (const key of keys.filter((k) => typeof k === 'string' && k.startsWith(PHOTO_PREFIX))) {
      const entry = await read(key);
      if (mine(entry)) photos.push({ key, id: entry.value.id, createdAt: entry.value.createdAt });
    }
    photos.sort((a, b) => a.createdAt - b.createdAt);
    for (const { key, id } of photos) {
      await withLock(
        id,
        async () => {
          const entry = await read(key);
          if (!mine(entry)) return;
          const { splitId, itemId, type, bytes } = entry.value;
          const query = new URLSearchParams({ [PHOTO_ID_PARAM]: id });
          if (itemId != null) query.set('itemId', itemId);
          await post(
            `/api/splits/${encodeURIComponent(splitId)}/attachments?${query}`,
            new Blob([bytes], { type }),
            entry.email,
          );
          // Saved, or refused (its item gone, the split full): either way it's done
          await drop(key);
        },
        PHOTO_LOCK_PREFIX,
      );
    }
  } finally {
    db.close();
  }
}

self.addEventListener('sync', (event) => {
  // Failing makes the browser try again later
  if (event.tag === SYNC_TAG) event.waitUntil(flushOfflineChanges());
});
