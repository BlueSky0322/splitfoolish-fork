import { clear, del, get, set } from 'idb-keyval';
import { LAST_PAGE_KEY } from './hooks/useRoute';

// Last-seen copies of API responses, kept in IndexedDB so pages show instantly on
// reload while fresh data loads. Entries are tagged with the signed-in email, and
// nothing is served until the server has confirmed who is signed in, so a different
// person on the same browser never sees the previous person's splits.

const LAST_EMAIL_KEY = 'splitfoolish:lastEmail';
/** The same email in IndexedDB, where the service worker can read it */
const SW_USER_KEY = 'sf-user';

let confirmUser: (email: string) => void;
const confirmedUser = new Promise<string>((resolve) => (confirmUser = resolve));

interface Entry<T> {
  email: string;
  value: T;
}

const lastEmail = () => {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY);
  } catch {
    return null;
  }
};

export async function readCache<T>(key: string): Promise<T | undefined> {
  const email = await confirmedUser;
  try {
    const entry = await get<Entry<T>>(key);
    return entry?.email === email ? entry.value : undefined;
  } catch {
    return undefined;
  }
}

export async function writeCache<T>(key: string, value: T): Promise<void> {
  const email = await confirmedUser;
  try {
    await set(key, { email, value } satisfies Entry<T>);
  } catch {
    // Storage can be unavailable (private browsing); the app works without it
  }
}

export async function removeCache(key: string): Promise<void> {
  try {
    await del(key);
  } catch {
    // ignore
  }
}

/** Call once the signed-in email is known; someone else's cache is dropped. */
export async function setCacheUser(email: string): Promise<void> {
  if (lastEmail() !== email) {
    // The page open now is this person's own: keep it when nobody was signed in before
    let page: string | null = null;
    try {
      page = lastEmail() == null ? localStorage.getItem(LAST_PAGE_KEY) : null;
    } catch {
      // ignore
    }
    await clearCache();
    try {
      if (page != null) localStorage.setItem(LAST_PAGE_KEY, page);
    } catch {
      // ignore
    }
    try {
      localStorage.setItem(LAST_EMAIL_KEY, email);
    } catch {
      // ignore
    }
  }
  try {
    await set(SW_USER_KEY, email);
  } catch {
    // ignore
  }
  confirmUser(email);
}

/**
 * Offline, the server can't say who's signed in: carry on as the last person signed
 * in on this device, so their saved splits and unsaved changes are there. Returns
 * their email, or null if nobody has signed in here.
 */
export function assumeLastUser(): string | null {
  const email = lastEmail();
  if (email) confirmUser(email);
  return email;
}

export async function clearCache(): Promise<void> {
  try {
    localStorage.removeItem(LAST_EMAIL_KEY);
    // The page they had open is theirs too
    localStorage.removeItem(LAST_PAGE_KEY);
    await clear();
    // Pictures and photos the service worker kept, so the next person can't see them
    if ('caches' in window) await caches.delete('splitfoolish-images-v1');
  } catch {
    // ignore
  }
}
