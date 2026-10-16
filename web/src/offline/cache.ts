import { clear, del, delMany, get, keys, set } from 'idb-keyval';
import { quietly } from '../utils/quietly';

// Last-seen copies of API responses (My splits, the profile, each split, and the
// outbox of unsaved changes), kept in IndexedDB so pages show instantly on reload and
// work offline. Entries are tagged with the signed-in email, and nothing is served
// until it's known who that is, so a different person on the same browser never sees
// the previous person's splits.

/** The page that was open last, reopened on a fresh start (see hooks/useRoute) */
export const LAST_PAGE_KEY = 'splitfoolish:lastPage';
/** Who last signed in on this device, assumed while the server can't say */
export const LAST_EMAIL_KEY = 'splitfoolish:lastEmail';
/** The signed-in email in IndexedDB, also read by public/sw.js (outbox.test.ts checks they match) */
export const SW_USER_KEY = 'sf-user';
/**
 * Marks the page when the service worker opened it from the copy it keeps, because the
 * server didn't send it in time (OPENED_FROM_DEVICE in public/sw.js)
 */
export const OPENED_FROM_DEVICE = 'sf-opened-from-device';
/** Pictures the service worker keeps (IMAGE_CACHE in public/sw.js) */
export const IMAGE_CACHE = 'splitfoolish-images-v1';

/** An entry as stored; public/sw.js reads the same shape */
interface Entry<T> {
  email: string;
  value: T;
}

/** Storage can be unavailable (private browsing, quota); the app works without it */
const quietlyAsync = <T>(access: () => Promise<T>): Promise<T | undefined> =>
  access().catch(() => undefined);

const lastEmail = () => quietly(() => localStorage.getItem(LAST_EMAIL_KEY)) ?? null;

// Who the cache is for: unknown until the server says (or, offline, the last person
// here is assumed). Reads and writes wait until then. It can change once more, when
// the server answers after an offline start as someone else.
let user: string | null = null;
let waiting: ((email: string) => void)[] = [];

const whenCacheUserKnown = (): Promise<string> =>
  user != null ? Promise.resolve(user) : new Promise((resolve) => waiting.push(resolve));

function confirmCacheUser(email: string) {
  user = email;
  for (const resolve of waiting) resolve(email);
  waiting = [];
}

export async function readCache<T>(key: string): Promise<T | undefined> {
  const email = await whenCacheUserKnown();
  const entry = await quietlyAsync(() => get<Entry<T>>(key));
  return entry?.email === email ? entry.value : undefined;
}

/** Whether `access` worked; storage failing is reported, not thrown */
const succeeds = (access: () => Promise<unknown>): Promise<boolean> =>
  access().then(
    () => true,
    () => false,
  );

/** Resolves with whether it was kept */
export async function writeCache<T>(key: string, value: T): Promise<boolean> {
  const email = await whenCacheUserKnown();
  return succeeds(() => set(key, { email, value } satisfies Entry<T>));
}

/** Resolves with whether it was removed */
export const removeCacheEntry = (key: string) => succeeds(() => del(key));

/** The ids kept under a key prefix ('outbox:', say), whoever's they are */
export const listCacheIds = async (prefix: string): Promise<string[]> =>
  ((await quietlyAsync(() => keys())) ?? [])
    .filter((k): k is string => typeof k === 'string' && k.startsWith(prefix))
    .map((k) => k.slice(prefix.length));

/**
 * Where a split's last-seen copy (a SplitDetail) is kept. Versioned, so a copy saved in
 * an older shape is never read: the split just loads afresh.
 */
export const splitCacheKey = (id: string) => `split-v2:${id}`;

// What older builds kept in a shape no longer read; versioned keys replaced them
const RETIRED_KEYS = ['me'];
const RETIRED_PREFIXES = ['split:'];

async function dropRetiredCopies() {
  const all = (await quietlyAsync(() => keys())) ?? [];
  const retired = all.filter(
    (k): k is string =>
      typeof k === 'string' &&
      (RETIRED_KEYS.includes(k) || RETIRED_PREFIXES.some((p) => k.startsWith(p))),
  );
  if (retired.length > 0) await quietlyAsync(() => delMany(retired));
}

/**
 * Call once the signed-in email is known; someone else's cache is dropped, and copies
 * older builds kept
 */
export async function setCacheUser(email: string): Promise<void> {
  if (lastEmail() !== email) {
    // The page open now is this person's own: keep it when nobody was signed in before
    const page = lastEmail() == null ? quietly(() => localStorage.getItem(LAST_PAGE_KEY)) : null;
    await clearCache();
    quietly(() => {
      if (page != null) localStorage.setItem(LAST_PAGE_KEY, page);
      localStorage.setItem(LAST_EMAIL_KEY, email);
    });
  }
  await quietlyAsync(() => set(SW_USER_KEY, email));
  await dropRetiredCopies();
  confirmCacheUser(email);
}

/**
 * Offline, the server can't say who's signed in: carry on as the last person signed
 * in on this device, so their saved splits and unsaved changes are there. Returns
 * their email, or null if nobody has signed in here.
 */
export function assumeLastUser(): string | null {
  const email = lastEmail();
  if (email) confirmCacheUser(email);
  return email;
}

/**
 * The service worker opened this page from the copy it keeps, as the server didn't send
 * it in time: the connection is down or slow, or the server is failing
 */
export const openedFromDevice = () =>
  document.querySelector(`meta[name="${OPENED_FROM_DEVICE}"]`) != null;

// What else the page holds for the account, forgotten with the cache (photos still to
// upload, say)
const forgetters = new Set<() => void>();

/** Runs `forget` whenever this device's cache is emptied: on signing out, or someone else signing in */
export const onCacheCleared = (forget: () => void) => void forgetters.add(forget);

/** Empties this device's cache, which is then nobody's until setCacheUser */
export async function clearCache(): Promise<void> {
  user = null;
  forgetters.forEach((forget) => forget());
  quietly(() => {
    localStorage.removeItem(LAST_EMAIL_KEY);
    // The page they had open is theirs too
    localStorage.removeItem(LAST_PAGE_KEY);
  });
  await quietlyAsync(() => clear());
  // Pictures and photos the service worker kept, so the next person can't see them
  if ('caches' in window) await quietlyAsync(() => caches.delete(IMAGE_CACHE));
}
