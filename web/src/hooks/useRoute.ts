import { useEffect, useState } from 'react';
import { LAST_PAGE_KEY } from '../offline/cache';
import { quietly } from '../utils/quietly';

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
const SESSION_KEY = 'splitfoolish:session';
// One-off parts of an address, such as an item to add from the converter
const TRANSIENT = ['join', 'add', 'from', 'amount'];

/** Remembers the page that's open, so the app can reopen there */
function rememberPage() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('join')) return;
  for (const key of TRANSIENT) params.delete(key);
  const search = params.toString();
  // Without storage, the app opens on My splits
  quietly(() => localStorage.setItem(LAST_PAGE_KEY, search ? `?${search}` : ''));
}

/**
 * Opening the app afresh at its start address (the installed app's icon, or typing the
 * address) goes back to the page that was open last time. A reload, or a link to a
 * particular page, keeps its own address. Called once at start, before the first render.
 */
export function restoreLastPage() {
  // Without storage, the app opens where the address says
  quietly(() => {
    const fresh = sessionStorage.getItem(SESSION_KEY) == null;
    sessionStorage.setItem(SESSION_KEY, '1');
    if (!fresh || window.location.search !== '') return;
    const last = localStorage.getItem(LAST_PAGE_KEY);
    if (last?.startsWith('?')) {
      window.history.replaceState(null, '', `${window.location.pathname}${last}`);
    }
  });
}

export function navigate(search: string, { replace = false } = {}) {
  const url = `${window.location.pathname}${search}`;
  // A page opened from another remembers which, so going "up" can be Back
  const from = replace ? cameFrom() : window.location.search;
  if (replace) window.history.replaceState({ from }, '', url);
  else window.history.pushState({ from }, '', url);
  window.dispatchEvent(new Event(ROUTE_CHANGE));
}

/** The address this page was opened from in the app, if it was */
const cameFrom = (): string | null => {
  const state: unknown = window.history.state;
  const from =
    typeof state === 'object' && state != null ? (state as { from?: unknown }).from : null;
  return typeof from === 'string' ? from : null;
};

export type Tab = 'splits' | 'invites' | 'convert' | 'you';

export const TAB_ADDRESS: Record<Tab, string> = {
  splits: '',
  invites: '?tab=invites',
  convert: '?convert',
  you: '?settings',
};

/** The bottom tab a page belongs to; a split is under Splits */
export function tabOf(route: Route): Tab | null {
  switch (route.view) {
    case 'home':
      return route.tab === 'invites' ? 'invites' : 'splits';
    case 'split':
      return 'splits';
    case 'convert':
      return 'convert';
    case 'settings':
      return 'you';
    default:
      return null;
  }
}

/**
 * Switches bottom tab. Tabs replace each other, so Back never steps through them; a
 * split opened from the list goes back to it, as the gesture would.
 */
export function goToTab(tab: Tab) {
  const address = TAB_ADDRESS[tab];
  if (window.location.search === address) return;
  if (cameFrom() === address) {
    window.history.back();
    return;
  }
  navigate(address, { replace: true });
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
