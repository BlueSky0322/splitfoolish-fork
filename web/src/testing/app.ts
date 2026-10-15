// Rendering the whole app in a test (jsdom), against a small in-memory stand-in for the
// API. Screen tests drive it the way a person would: by what's on screen.

// IndexedDB, for the offline cache
import 'fake-indexeddb/auto';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, vi } from 'vitest';
import type { MyInvite, Profile, SplitDetail, SplitSummary } from '../../../shared/api';
import { DEFAULT_SETTINGS } from '../../../shared/api';
import type { Change, Item } from '../../../shared/types';
import { Root } from '../Root';
import { queryClient } from '../query-client';

// What jsdom doesn't have, and the app (or Mantine) uses
function stubBrowser() {
  // Wide enough for the desktop layout
  window.matchMedia = (query: string) => ({
    matches: query.includes('min-width'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView = () => {};
  // Live updates: a socket that opens and never hears anything
  vi.stubGlobal(
    'WebSocket',
    class {
      readyState = 1;
      send() {}
      close() {}
      addEventListener() {}
      removeEventListener() {}
    },
  );
}

/** The data the stand-in server holds; tests set it up and read it back */
export interface FakeServer {
  /** False: every request is turned away, as when the sign-in has expired */
  signedIn: boolean;
  me: Profile;
  splits: Map<string, SplitDetail>;
  invites: MyInvite[];
  /** 1 `from` is `rate` `to` */
  rates: Map<string, number>;
  /** Every batch of changes the app sent, by split */
  sent: { splitId: string; changes: Change[] }[];
}

export const person = (id: string, name: string, memberEmail: string | null = null) => ({
  id,
  name,
  memberEmail,
});

export const item = (over: Partial<Item> & Pick<Item, 'id' | 'name' | 'cost'>): Item => ({
  payerId: 'me',
  participantIds: ['me', 'ann'],
  splitMode: 'equal',
  category: null,
  createdAt: Date.UTC(2026, 9, 10, 12),
  ...over,
});

const EMAIL = 'ryan@example.com';

/** One split, "Trip" in MYR, with Ryan (signed in) and Ann */
export function splitDetail(id: string, items: Item[] = []): SplitDetail {
  return {
    id,
    name: 'Trip',
    currency: 'MYR',
    distributorId: null,
    pictureVersion: null,
    converting: false,
    role: 'owner',
    members: [
      { email: EMAIL, role: 'owner', displayName: 'Ryan', avatarVersion: null, paymentMethods: [] },
    ],
    invites: [],
    inviteToken: 'token',
    attachments: [],
    people: [person('me', 'Ryan', EMAIL), person('ann', 'Ann')],
    items,
  };
}

const summaryOf = (s: SplitDetail): SplitSummary => ({
  id: s.id,
  name: s.name,
  currency: s.currency,
  role: s.role,
  memberCount: s.members.length,
  peopleCount: s.people.length,
  totalCents: s.items.reduce((sum, i) => sum + Math.round(i.cost * 100), 0),
  myBalanceCents: null,
  pictureVersion: s.pictureVersion,
  updatedAt: 1,
});

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

/** Applies the changes the app sends, as far as the screens in these tests need */
function apply(split: SplitDetail, change: Change) {
  switch (change.op) {
    case 'addItem':
      split.items.push(change.item);
      break;
    case 'updateItem':
      split.items = split.items.map((i) => (i.id === change.item.id ? change.item : i));
      break;
    case 'removeItem':
      split.items = split.items.filter((i) => i.id !== change.id);
      break;
    case 'addPerson':
      split.people.push(person(change.id, change.name, change.memberEmail ?? null));
      break;
    default:
      break;
  }
}

function serve(server: FakeServer) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input, 'http://app');
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    const path = url.pathname;
    const splitMatch = path.match(/^\/api\/splits\/([^/]+)(\/changes)?$/);

    if (!server.signedIn) return json({ error: 'Signed out' }, 401);
    if (path === '/api/me' && method === 'GET') return json(server.me);
    if (path === '/api/me' && method === 'PATCH') {
      const patch = body as Partial<Profile>;
      server.me = {
        ...server.me,
        ...('displayName' in patch ? { displayName: patch.displayName ?? null } : {}),
        settings: { ...server.me.settings, ...patch.settings },
      };
      return json(server.me);
    }
    if (path === '/api/splits' && method === 'GET') {
      return json({ splits: [...server.splits.values()].map(summaryOf) });
    }
    if (path === '/api/splits' && method === 'POST') {
      const { id, name, currency } = body as { id: string; name: string; currency: string };
      server.splits.set(id, {
        ...splitDetail(id),
        name,
        currency,
        people: [person('me', 'Ryan', EMAIL)],
      });
      return json({ id }, 201);
    }
    if (path === '/api/invites') return json({ invites: server.invites });
    if (path === '/api/item-names') return json({ names: [] });
    if (path === '/api/rates') {
      const [from, to] = [url.searchParams.get('from'), url.searchParams.get('to')];
      const rate = server.rates.get(`${from}${to}`);
      return rate == null
        ? json({ error: 'No rate' }, 503)
        : json({ from, to, rate, source: 'wise', fetchedAt: Date.now() });
    }
    if (splitMatch) {
      const split = server.splits.get(splitMatch[1]);
      if (split == null) return json({ error: 'Not found' }, 404);
      if (splitMatch[2] && method === 'POST') {
        const { changes } = body as { changes: Change[] };
        server.sent.push({ splitId: split.id, changes });
        for (const change of changes) apply(split, change);
        return json({ ok: true });
      }
      if (method === 'GET') return json(structuredClone(split));
    }
    return json({ error: `No stand-in for ${method} ${path}` }, 404);
  };
}

/** A fresh server with the signed-in account and the given splits */
export function fakeServer(...splits: SplitDetail[]): FakeServer {
  return {
    signedIn: true,
    me: {
      email: EMAIL,
      displayName: 'Ryan',
      avatarVersion: null,
      paymentMethods: [],
      preferredPaymentMethodId: null,
      settings: { ...DEFAULT_SETTINGS, lastCurrency: 'MYR' },
    },
    splits: new Map(splits.map((s) => [s.id, s])),
    invites: [],
    rates: new Map(),
    sent: [],
  };
}

/** Renders the app at `path` (say "/?s=trip"), talking to `server` */
export function renderApp(server: FakeServer, path = '/') {
  vi.stubGlobal('fetch', vi.fn(serve(server)));
  window.history.replaceState(null, '', path);
  return render(createElement(Root));
}

/** Call in a screen test's file: a browser to render into, emptied between tests */
export function setupAppTests() {
  beforeEach(() => {
    stubBrowser();
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.unstubAllGlobals();
  });
}
