import { useEffect, useState } from 'react';

export type Route =
  | { view: 'home'; tab: string | null }
  | { view: 'split'; id: string }
  | { view: 'join'; token: string }
  | { view: 'settings' };

function readRoute(): Route {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('s');
  const token = params.get('join');
  if (token) return { view: 'join', token };
  if (id) return { view: 'split', id };
  if (params.has('settings')) return { view: 'settings' };
  return { view: 'home', tab: params.get('tab') };
}

const ROUTE_CHANGE = 'routechange';

export function navigate(search: string, { replace = false } = {}) {
  const url = `${window.location.pathname}${search}`;
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  window.dispatchEvent(new Event(ROUTE_CHANGE));
}

// Pages are picked from the query string: ?s=<id> is a split, ?join=<token> joins one,
// ?settings is Settings, and ?tab=<name> picks a My Splits tab
export function useRoute(): Route {
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    const update = () => setRoute(readRoute());
    window.addEventListener('popstate', update);
    window.addEventListener(ROUTE_CHANGE, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(ROUTE_CHANGE, update);
    };
  }, []);

  return route;
}
