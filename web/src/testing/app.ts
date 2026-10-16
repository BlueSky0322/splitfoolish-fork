// Rendering the whole app in a test (jsdom), against a small in-memory stand-in for the
// API. Screen tests drive it the way a person would: by what's on screen.

// IndexedDB, for the offline cache
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { URL as NodeURL, fileURLToPath } from 'node:url';
import { cleanup, configure, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, vi } from 'vitest';
import type { Attachment, MyInvite, Profile, SplitDetail, SplitSummary } from '@shared/api';
import { DEFAULT_SETTINGS, MAX_CHANGES, MAX_PHOTO_BYTES } from '@shared/api';
import { toCents } from '@shared/rates';
import { type SettleItem, balances } from '@shared/settle';
import type { Change, Item } from '@shared/types';
import { Root } from '../Root';
import { queryClient } from '../query-client';
import { forgetOfflineWork } from '../offline/sync';

// The whole app renders in each test, which takes a while when every test file runs at
// once: wait longer than the default second for things to appear
configure({ asyncUtilTimeout: 4000 });

/** The screen tests run at: a computer, or a phone */
let screenSize: 'desktop' | 'phone' = 'desktop';

// What jsdom doesn't have, and the app (or Mantine) uses
function stubBrowser() {
  window.matchMedia = (query: string) => ({
    matches: query.includes(screenSize === 'desktop' ? 'min-width' : 'max-width'),
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
  sockets.length = 0;
  vi.stubGlobal('WebSocket', FakeSocket);
}

/** Where a split's live updates come from: /api/splits/<id>/ws, on ws: or wss: */
const LIVE_PATH = /^\/api\/splits\/([^/]+)\/ws$/;

/**
 * A live-updates socket. One to a split's live endpoint joins that split's room and opens
 * straight away; one to anywhere else fails, as the server would turn it away. A socket
 * closed before it opened stays closed.
 */
class FakeSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readyState = 0;
  /** The split whose room this joined, or null when the address isn't a live endpoint */
  readonly room: string | null;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(readonly url: string) {
    const address = new URL(url);
    const live = /^wss?:$/.test(address.protocol) ? LIVE_PATH.exec(address.pathname) : null;
    this.room = live ? decodeURIComponent(live[1]) : null;
    sockets.push(this);
    setTimeout(() => {
      // Closed meanwhile: it never opens
      if (this.readyState !== 0) return;
      if (this.room == null) {
        this.close(1006);
        return;
      }
      this.readyState = FakeSocket.OPEN;
      this.onopen?.();
    });
  }
  send() {}
  close(code = 1000) {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code });
  }
  /** As the server says someone saved a change; only an open socket hears it */
  hear(message: unknown) {
    if (this.readyState !== FakeSocket.OPEN) return;
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const sockets: FakeSocket[] = [];

/** The live-updates sockets the app has opened, newest last */
export const liveSockets = (): readonly FakeSocket[] => sockets;

/** The sockets open now in a split's room, as the server would tell them about changes */
export const liveRoom = (splitId: string): readonly FakeSocket[] =>
  sockets.filter((s) => s.room === splitId && s.readyState === FakeSocket.OPEN);

/** The data the stand-in server holds; tests set it up and read it back */
export interface FakeServer {
  /**
   * Signed out (the sign-in expired) or down: every request is turned away. Unreachable:
   * no request gets there at all, as with no connection.
   */
  health: 'up' | 'signedOut' | 'down' | 'unreachable';
  me: Profile;
  splits: Map<string, SplitDetail>;
  /** Splits whose share link you can open, but that you're not in yet */
  notJoined: SplitDetail[];
  invites: MyInvite[];
  /** 1 `from` is `rate` `to` */
  rates: Map<string, number>;
  /** Every batch of changes the app sent, by split */
  sent: { splitId: string; changes: Change[] }[];
  /** Every photo the app uploaded and the server kept, in the order they arrived */
  uploads: { splitId: string; itemId: string | null; image: Blob }[];
  /**
   * The next save of the profile, a split's changes or its settings, or the next photo
   * upload, answers with this status
   */
  failNext: Partial<Record<'profile' | 'changes' | 'settings' | 'join' | 'photo', number>>;
  /** Splits the signed-in account has archived */
  archived: Set<string>;
  /** Answers being held back until a test releases them (see holdNext) */
  held: { method: string; path: string; release: Promise<void> }[];
}

/**
 * Holds back the answer to the next `method` request for `path`: it's worked out when
 * the request arrives (so it shows the server as it was then) and delivered once
 * `release` is called. For putting answers in a different order than their requests.
 */
export function holdNext(server: FakeServer, method: string, path: string) {
  let release = () => {};
  server.held.push({ method, path, release: new Promise<void>((r) => (release = r)) });
  return { release };
}

export const person = (id: string, name: string, memberEmail: string | null = null) => ({
  id,
  name,
  memberEmail,
});

export const item = (over: Partial<Item> & Pick<Item, 'id' | 'name' | 'cost'>): Item => ({
  payerId: 'me',
  participantIds: ['me', 'ann'],
  notes: null,
  original: null,
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
    shareToken: 'token',
    attachments: [],
    people: [person('me', 'Ryan', EMAIL), person('ann', 'Ann')],
    items,
  };
}

/** Where the signed-in account stands in a split, as the server works it out */
const settleItems = (s: SplitDetail) =>
  s.items.map(
    (i): SettleItem => ({
      costCents: toCents(i.cost),
      payerId: i.payerId,
      splitMode: i.splitMode,
      participants: i.participantIds.map((personId) => ({
        personId,
        shares: i.shares?.[personId] ?? 1,
        exactCents: i.exact?.[personId] == null ? null : toCents(i.exact[personId]),
      })),
    }),
  );

function myBalance(s: SplitDetail) {
  const me = s.people.find((p) => p.memberEmail === EMAIL);
  if (me == null) return null;
  return balances([me.id], settleItems(s)).get(me.id)!.balanceCents;
}

const summaryOf = (s: SplitDetail, archived: boolean): SplitSummary => ({
  id: s.id,
  name: s.name,
  currency: s.currency,
  role: s.role,
  memberCount: s.members.length,
  peopleCount: s.people.length,
  itemCount: s.items.length,
  totalCents: s.items.reduce((sum, i) => sum + toCents(i.cost), 0),
  settled:
    s.items.length > 0 &&
    [
      ...balances(
        s.people.map((p) => p.id),
        settleItems(s),
      ).values(),
    ].every((b) => b.balanceCents === 0),
  archived,
  myBalanceCents: myBalance(s),
  pictureVersion: s.pictureVersion,
  updatedAt: 1,
});

/** The PDF export's font, from web/public as the app is served it; read when first asked for */
let font: Buffer | null = null;
const fontFile = () =>
  (font ??= readFileSync(
    fileURLToPath(new NodeURL('../../public/fonts/NotoSansJP-subset.ttf', import.meta.url)),
  ));

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
      // So a test that needs another change says so, rather than passing by accident
      throw new Error(`No stand-in for the change ${change.op}`);
  }
}

function serve(server: FakeServer) {
  const answer = answerNow(server);
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const response = answer(input, init);
    const method = init?.method ?? 'GET';
    const path = new URL(input instanceof Request ? input.url : input, 'http://app').pathname;
    const at = server.held.findIndex((h) => h.method === method && h.path === path);
    if (at < 0) return response;
    const [{ release }] = server.held.splice(at, 1);
    return release.then(() => response);
  };
}

function answerNow(server: FakeServer) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input, 'http://app');
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    const path = url.pathname;
    const splitMatch = path.match(/^\/api\/splits\/([^/]+)(\/changes)?$/);
    const inviteMatch = path.match(/^\/api\/splits\/([^/]+)\/invites\/([^/]+)$/);

    if (server.health === 'unreachable') return Promise.reject(new TypeError('Failed to fetch'));
    if (server.health === 'signedOut') return json({ error: 'Signed out' }, 401);
    if (server.health === 'down') return json({ error: 'Internal error' }, 500);
    if (path === '/api/me' && method === 'GET') return json(server.me);
    if (path === '/fonts/NotoSansJP-subset.ttf') {
      return Promise.resolve(new Response(fontFile(), { headers: { 'Content-Type': 'font/ttf' } }));
    }
    const failing = (kind: keyof FakeServer['failNext']) => {
      const status = server.failNext[kind];
      delete server.failNext[kind];
      return (
        status &&
        json(
          { error: status === 409 ? 'Refused' : 'Something went wrong. Try again in a moment.' },
          status,
        )
      );
    };
    if (path === '/api/me' && method === 'PATCH') {
      const failure = failing('profile');
      if (failure) return failure;
      const patch = body as Partial<Profile>;
      server.me = {
        ...server.me,
        ...('displayName' in patch ? { displayName: patch.displayName ?? null } : {}),
        settings: { ...server.me.settings, ...patch.settings },
      };
      return json(server.me);
    }
    if (path === '/api/splits' && method === 'GET') {
      return json({
        splits: [...server.splits.values()].map((s) => summaryOf(s, server.archived.has(s.id))),
      });
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
    const joinMatch = path.match(/^\/api\/join\/([^/]+)$/);
    if (joinMatch && method === 'POST') {
      const failure = failing('join');
      if (failure) return failure;
      const split = [...server.splits.values()].find((s) => s.shareToken === joinMatch[1]);
      if (split) return json({ status: 'member', id: split.id });
      const other = server.notJoined.find((s) => s.shareToken === joinMatch[1]);
      if (other == null) return json({ error: 'This invite link is no longer valid' }, 404);
      // An invite from the owner, waiting in Invites to be accepted
      const invite: MyInvite = {
        kind: 'invite',
        id: `invite-${other.id}`,
        splitId: other.id,
        splitName: other.name,
        invitedBy: 'ann@example.com',
        invitedByName: 'Ann',
        createdAt: Date.now(),
        expiresAt: Date.now() + 7 * 86_400_000,
      };
      server.invites = [...server.invites.filter((i) => i.id !== invite.id), invite];
      return json({ status: 'invited', id: other.id, inviteId: invite.id });
    }
    const answerMatch = path.match(/^\/api\/invites\/([^/]+)\/(accept|decline)$/);
    if (answerMatch && method === 'POST') {
      const invite = server.invites.find((i) => i.id === answerMatch[1]);
      if (invite == null) return json({ error: 'That invite is no longer open' }, 404);
      server.invites = server.invites.filter((i) => i !== invite);
      const split = server.notJoined.find((s) => s.id === invite.splitId);
      if (answerMatch[2] === 'decline' || split == null) return json({ ok: true });
      server.notJoined = server.notJoined.filter((s) => s !== split);
      server.splits.set(split.id, { ...split, role: 'editor' });
      return json({ id: split.id });
    }
    if (path === '/api/item-names') return json({ names: [] });
    if (path === '/api/archived' && method === 'PUT') {
      const { id, archived } = body as { id: string; archived: boolean };
      if (archived) server.archived.add(id);
      else server.archived.delete(id);
      return json({ ok: true });
    }
    if (path === '/api/search') {
      const text = (url.searchParams.get('q') ?? '').toLowerCase();
      const items = [...server.splits.values()].flatMap((s) =>
        s.items
          .filter((i) => i.name.toLowerCase().includes(text))
          .map((i) => ({
            id: i.id,
            name: i.name,
            costCents: toCents(i.cost),
            category: i.category,
            createdAt: i.createdAt,
            splitId: s.id,
            splitName: s.name,
            currency: s.currency,
          })),
      );
      return json({ items });
    }
    if (path === '/api/rates') {
      const [from, to] = [url.searchParams.get('from'), url.searchParams.get('to')];
      const rate = server.rates.get(`${from}${to}`);
      return rate == null
        ? json({ error: 'No rate' }, 503)
        : json({ from, to, rate, source: 'wise', fetchedAt: Date.now() });
    }
    // A photo's bytes: its id, so a test can tell which one it got
    const photoFile = path.match(/^\/api\/splits\/([^/]+)\/attachments\/([^/]+)$/);
    if (photoFile && method === 'GET') {
      const photo = server.splits.get(photoFile[1])?.attachments.find((a) => a.id === photoFile[2]);
      return Promise.resolve(
        photo
          ? new Response(`photo ${photo.id}`, { headers: { 'Content-Type': photo.contentType } })
          : new Response('Not found', { status: 404 }),
      );
    }
    // Adding a photo, as worker/photos.ts does: at most 300 to a split, a receipt only on
    // an item that exists, and no larger than MAX_PHOTO_BYTES
    const addPhoto = path.match(/^\/api\/splits\/([^/]+)\/attachments$/);
    if (addPhoto && method === 'POST') {
      const split = server.splits.get(addPhoto[1]);
      if (split == null) return json({ error: 'Not found' }, 404);
      const failure = failing('photo');
      if (failure) return failure;
      if (split.attachments.length >= 300) {
        return json({ error: 'A split can have up to 300 photos' }, 409);
      }
      const itemId = url.searchParams.get('itemId');
      if (itemId != null && !split.items.some((i) => i.id === itemId)) {
        return json({ error: 'That item no longer exists' }, 404);
      }
      const image = init?.body;
      if (!(image instanceof Blob) || image.size === 0) {
        return json({ error: 'No photo was sent' }, 400);
      }
      if (image.size > MAX_PHOTO_BYTES) return json({ error: 'That photo is too large' }, 413);
      server.uploads.push({ splitId: split.id, itemId, image });
      const added: Attachment = {
        id: `photo-${server.uploads.length}`,
        itemId,
        size: image.size,
        contentType: 'image/jpeg',
        uploadedBy: server.me.email,
        createdAt: Date.now(),
      };
      split.attachments.push(added);
      return json(added, 201);
    }
    const removePhotos = path.match(/^\/api\/splits\/([^/]+)\/attachments\/remove$/);
    if (removePhotos && method === 'POST') {
      const split = server.splits.get(removePhotos[1]);
      if (split == null) return json({ error: 'Not found' }, 404);
      const { ids } = body as { ids: string[] };
      split.attachments = split.attachments.filter((a) => !ids.includes(a.id));
      return json({ ok: true });
    }
    if (splitMatch) {
      const split = server.splits.get(splitMatch[1]);
      if (split == null) return json({ error: 'Not found' }, 404);
      if (splitMatch[2] && method === 'POST') {
        const failure = failing('changes');
        if (failure) return failure;
        const { changes } = body as { changes: Change[] };
        // The real API's limit, so a test can't pass by sending more than it takes
        if (changes.length === 0 || changes.length > MAX_CHANGES) {
          return json({ error: `Send 1-${MAX_CHANGES} changes` }, 400);
        }
        server.sent.push({ splitId: split.id, changes });
        for (const change of changes) apply(split, change);
        return json({ ok: true });
      }
      if (method === 'GET') return json(structuredClone(split));
      if (method === 'PATCH') {
        const failure = failing('settings');
        if (failure) return failure;
        const { name, currency } = body as { name: string; currency: string };
        Object.assign(split, { name, currency });
        return json({ converting: false });
      }
    }
    if (inviteMatch && method === 'DELETE') {
      const split = server.splits.get(inviteMatch[1]);
      if (split == null) return json({ error: 'Not found' }, 404);
      split.invites = split.invites?.filter((i) => i.id !== inviteMatch[2]);
      return json({ ok: true });
    }
    return json({ error: `No stand-in for ${method} ${path}` }, 404);
  };
}

/** A fresh server with the signed-in account and the given splits */
export function fakeServer(...splits: SplitDetail[]): FakeServer {
  return {
    health: 'up',
    me: {
      email: EMAIL,
      displayName: 'Ryan',
      avatarVersion: null,
      paymentMethods: [],
      preferredPaymentMethodId: null,
      settings: { ...DEFAULT_SETTINGS, lastCurrency: 'MYR' },
    },
    splits: new Map(splits.map((s) => [s.id, s])),
    notJoined: [],
    invites: [],
    rates: new Map(),
    sent: [],
    uploads: [],
    failNext: {},
    archived: new Set(),
    held: [],
  };
}

/** Renders the app at `path` (say "/?s=trip"), talking to `server` */
export function renderApp(
  server: FakeServer,
  path = '/',
  { size = 'desktop' }: { size?: typeof screenSize } = {},
) {
  screenSize = size;
  vi.stubGlobal('innerWidth', size === 'desktop' ? 1280 : 390);
  vi.stubGlobal('fetch', vi.fn(serve(server)));
  window.history.replaceState(null, '', path);
  return render(createElement(Root));
}

/** Call in a screen test's file: a browser to render into, emptied between tests */
export function setupAppTests() {
  beforeEach(() => {
    stubBrowser();
    // What the app tries again, it tries again straight away
    queryClient.setDefaultOptions({
      ...queryClient.getDefaultOptions(),
      queries: { ...queryClient.getDefaultOptions().queries, retryDelay: 0 },
    });
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(async () => {
    cleanup();
    queryClient.clear();
    // The device's cache, and whose it is, start empty for the next test
    await forgetOfflineWork();
    vi.unstubAllGlobals();
  });
}
