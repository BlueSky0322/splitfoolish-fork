import { clear, del, get, set } from 'idb-keyval';
import { quietly } from '../utils/quietly';

// Last-seen copies of API responses (My splits, the profile, each split, and the
// outbox of unsaved changes), kept in IndexedDB so pages show instantly on reload and
// work offline. Entries are tagged with the signed-in email, and nothing is served
// until it's known who that is, so a different person on the same browser never sees
// the previous person's splits.

/** The page that was open last, reopened on a fresh start (see hooks/useRoute) */
export const LAST_PAGE_KEY = 'splitfoolish:lastPage';
const LAST_EMAIL_KEY = 'splitfoolish:lastEmail';
/** The signed-in email in IndexedDB, where the service worker reads it (public/sw.js) */
const SW_USER_KEY = 'sf-user';
/** Pictures the service worker keeps (IMAGE_CACHE in public/sw.js) */
const IMAGE_CACHE = 'splitfoolish-images-v1';

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

const cacheUser = (): Promise<string> =>
  user != null ? Promise.resolve(user) : new Promise((resolve) => waiting.push(resolve));

function confirmCacheUser(email: string) {
  user = email;
  for (const resolve of waiting) resolve(email);
  waiting = [];
}

export async function readCache<T>(key: string): Promise<T | undefined> {
  const email = await cacheUser();
  const entry = await quietlyAsync(() => get<Entry<T>>(key));
  return entry?.email === email ? entry.value : undefined;
}

export async function writeCache<T>(key: string, value: T): Promise<void> {
  const email = await cacheUser();
  await quietlyAsync(() => set(key, { email, value } satisfies Entry<T>));
}

export const removeCache = (key: string) => quietlyAsync(() => del(key));

/**
 * Where a split's last-seen copy (a SplitDetail) is kept. Versioned, so a copy saved in
 * an older shape is never read: the split just loads afresh.
 */
export const splitCacheKey = (id: string) => `split-v2:${id}`;

/** Call once the signed-in email is known; someone else's cache is dropped. */
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

/** Empties this device's cache, which is then nobody's until setCacheUser */
export async function clearCache(): Promise<void> {
  user = null;
  quietly(() => {
    localStorage.removeItem(LAST_EMAIL_KEY);
    // The page they had open is theirs too
    localStorage.removeItem(LAST_PAGE_KEY);
  });
  await quietlyAsync(() => clear());
  // Pictures and photos the service worker kept, so the next person can't see them
  if ('caches' in window) await quietlyAsync(() => caches.delete(IMAGE_CACHE));
}
