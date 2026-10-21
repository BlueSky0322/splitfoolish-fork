import { clear, del, delMany, get, getMany, keys, set } from 'idb-keyval';
import { writeAs } from '../api';
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
/**
 * That marker's content when Cloudflare Access asked to sign in again, rather than the
 * server being out of reach (SIGNED_OUT in public/sw.js)
 */
export const OPENED_SIGNED_OUT = 'signed-out';
/**
 * Marks a page load as going to sign in: the service worker leaves it to the browser, so
 * Cloudflare Access's sign-in page shows rather than the kept page (SIGN_IN_PARAM in
 * public/sw.js)
 */
export const SIGN_IN_PARAM = 'sign-in';
/**
 * Pictures and photos the service worker keeps, one cache per account named with its
 * email after this prefix (IMAGE_CACHE_PREFIX in public/sw.js)
 */
export const IMAGE_CACHE_PREFIX = 'splitfoolish-images-v2:';
/** Where builds before that kept everyone's pictures together */
const RETIRED_IMAGE_CACHE = 'splitfoolish-images-v1';
/**
 * Keys of work not yet on the server: changes (OUTBOX_PREFIX), new splits (CREATE_PREFIX)
 * and photos (PHOTO_PREFIX). Kept for their own account when someone else signs in,
 * readable and sendable by nobody else (cache.test.ts checks these match)
 */
export const UNSENT_PREFIXES = ['outbox:', 'create:', 'photo:'];

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

/** Whose the cache is now, or null while that isn't known */
export const cacheUser = () => user;

const whenCacheUserKnown = (): Promise<string> =>
  user != null ? Promise.resolve(user) : new Promise((resolve) => waiting.push(resolve));

function confirmCacheUser(email: string) {
  user = email;
  // The page's writes are made as this account, and refused once it's anyone else's
  writeAs(email);
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
    // What the last account hasn't sent yet stays, theirs alone, for when they're back
    await clearCache(() => true);
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

/** The service worker opened this page from its copy because Cloudflare Access asked to sign in */
export const openedSignedOut = () =>
  document.querySelector(`meta[name="${OPENED_FROM_DEVICE}"]`)?.getAttribute('content') ===
  OPENED_SIGNED_OUT;

/** This page's address, marked to go to sign in and come back to it */
export function signInAddress(): string {
  const url = new URL(window.location.href);
  url.searchParams.set(SIGN_IN_PARAM, '');
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Back from signing in: the mark comes off the address, which is otherwise as it was */
export function dropSignInMark() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(SIGN_IN_PARAM)) return;
  url.searchParams.delete(SIGN_IN_PARAM);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

// What else the page holds for the account, forgotten with the cache (photos still to
// upload, say)
const forgetters = new Set<() => void>();

/** Runs `forget` whenever this device's cache is emptied: on signing out, or someone else signing in */
export const onCacheCleared = (forget: () => void) => void forgetters.add(forget);

/**
 * Empties this device's cache, which is then nobody's until setCacheUser. Work not yet
 * sent is kept for the accounts `keepUnsentOf` names: tagged with their email, it's
 * nobody else's to see or send.
 */
export async function clearCache(
  keepUnsentOf: (email: string) => boolean = () => false,
): Promise<void> {
  user = null;
  writeAs(null);
  forgetters.forEach((forget) => forget());
  quietly(() => {
    localStorage.removeItem(LAST_EMAIL_KEY);
    // The page they had open is theirs too
    localStorage.removeItem(LAST_PAGE_KEY);
  });
  await quietlyAsync(() => clearExceptUnsent(keepUnsentOf));
  // Pictures and photos the service worker kept, so the next person can't see them
  if ('caches' in window) await quietlyAsync(clearImageCaches);
}

async function clearImageCaches() {
  const names = (await caches.keys()).filter(
    (name) => name.startsWith(IMAGE_CACHE_PREFIX) || name === RETIRED_IMAGE_CACHE,
  );
  await Promise.all(names.map((name) => caches.delete(name)));
}

async function clearExceptUnsent(keepUnsentOf: (email: string) => boolean) {
  const all = await keys();
  const unsent = all.filter(
    (k): k is string => typeof k === 'string' && UNSENT_PREFIXES.some((p) => k.startsWith(p)),
  );
  const entries = await getMany<Entry<unknown> | undefined>(unsent);
  const kept = new Set(
    unsent.filter((_, i) => entries[i] != null && keepUnsentOf(entries[i].email)),
  );
  if (kept.size === 0) return clear();
  await delMany(all.filter((k) => !kept.has(k as string)));
}
