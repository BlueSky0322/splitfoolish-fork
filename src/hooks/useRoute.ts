import { useEffect, useState } from 'react';

export type Route =
  | { view: 'home'; tab: string | null }
  | { view: 'split'; id: string }
  | { view: 'join'; token: string }
  | { view: 'settings' }
  | { view: 'convert' };

function readRoute(): Route {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('s');
  const token = params.get('join');
  if (token) return { view: 'join', token };
  if (id) return { view: 'split', id };
  if (params.has('settings')) return { view: 'settings' };
  if (params.has('convert')) return { view: 'convert' };
  return { view: 'home', tab: params.get('tab') };
}

const ROUTE_CHANGE = 'routechange';
export const LAST_PAGE_KEY = 'splitfoolish:lastPage';
const SESSION_KEY = 'splitfoolish:session';
// One-off parts of an address, such as an item to add from the converter
const TRANSIENT = ['join', 'add', 'from', 'amount'];

/** Remembers the page that's open, so the app can reopen there */
function rememberPage() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('join')) return;
  for (const key of TRANSIENT) params.delete(key);
  const search = params.toString();
  try {
    localStorage.setItem(LAST_PAGE_KEY, search ? `?${search}` : '');
  } catch {
    // Storage can be unavailable; the app opens on My splits then
  }
}

// Opening the app afresh at its start address (the installed app's icon, or typing
// the address) goes back to the page that was open last time. A reload, or a link to
// a particular page, keeps its own address.
(function restoreLastPage() {
  try {
    const fresh = sessionStorage.getItem(SESSION_KEY) == null;
    sessionStorage.setItem(SESSION_KEY, '1');
    if (!fresh || window.location.search !== '') return;
    const last = localStorage.getItem(LAST_PAGE_KEY);
    if (last?.startsWith('?')) {
      window.history.replaceState(null, '', `${window.location.pathname}${last}`);
    }
  } catch {
    // ignore
  }
})();

export function navigate(search: string, { replace = false } = {}) {
  const url = `${window.location.pathname}${search}`;
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  window.dispatchEvent(new Event(ROUTE_CHANGE));
}

// Pages are picked from the query string: ?s=<id> is a split, ?join=<token> joins one,
// ?settings is Settings, ?convert the currency converter, and ?tab=<name> picks a My
// Splits tab
export function useRoute(): Route {
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    const update = () => {
      setRoute(readRoute());
      rememberPage();
    };
    rememberPage();
    window.addEventListener('popstate', update);
    window.addEventListener(ROUTE_CHANGE, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(ROUTE_CHANGE, update);
    };
  }, []);

  return route;
}
