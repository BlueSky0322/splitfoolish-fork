// The API end to end, against the real Worker and a fresh local database: who can see
// and change what, the rules for changing a split, and the share-link invite flows.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalWorker, startLocalWorker } from './local-worker';

let api: LocalWorker;
let n = 0;
// Fresh accounts for each test, so tests don't see each other's splits
const person = (name: string) => `${name}${++n}@example.com`;
const hex = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

beforeAll(async () => {
  api = await startLocalWorker();
}, 120_000);

afterAll(() => api?.stop());

/** A split owned by `owner`, with `members` already in it through the share link */
async function splitWith(owner: string, ...members: string[]) {
  const { data } = await api.call(owner, 'POST', '/api/splits', { name: 'Trip', currency: 'MYR' });
  const id: string = data.id;
  const token: string = (await api.call(owner, 'GET', `/api/splits/${id}`)).data.inviteToken;
  for (const m of members) {
    const opened = await api.call(m, 'POST', `/api/join/${token}`);
    await api.call(m, 'POST', `/api/invites/${opened.data.inviteId}/accept`);
  }
  return { id, token };
}

const change = (who: string, id: string, ...changes: unknown[]) =>
  api.call(who, 'POST', `/api/splits/${id}/changes`, { changes });

describe('who can see a split', () => {
  it('hides it from people who are not in it', async () => {
    const owner = person('owner');
    const stranger = person('stranger');
    const { id } = await splitWith(owner);
    expect((await api.call(stranger, 'GET', `/api/splits/${id}`)).status).toBe(404);
    expect((await change(stranger, id, { op: 'clearItems' })).status).toBe(404);
    expect((await api.call(stranger, 'GET', `/api/splits/${id}/picture`)).status).toBe(404);
    expect((await api.call(stranger, 'GET', '/api/splits')).data.splits).toEqual([]);
  });

  it('keeps owner-only actions for the owner', async () => {
    const owner = person('owner');
    const editor = person('editor');
    const { id } = await splitWith(owner, editor);
    expect(
      (await api.call(editor, 'PATCH', `/api/splits/${id}`, { name: 'Mine now' })).status,
    ).toBe(403);
    expect((await api.call(editor, 'POST', `/api/splits/${id}/invite`)).status).toBe(403);
    expect((await api.call(editor, 'DELETE', `/api/splits/${id}`)).status).toBe(403);
    expect(
      (await api.call(editor, 'DELETE', `/api/splits/${id}/members/${owner}`)).status,
    ).not.toBe(200);
    // Members share with a link of their own, never the owner's
    const ownToken = (await api.call(editor, 'GET', `/api/splits/${id}`)).data.inviteToken;
    const ownerToken = (await api.call(owner, 'GET', `/api/splits/${id}`)).data.inviteToken;
    expect(ownToken).toBeTruthy();
    expect(ownToken).not.toBe(ownerToken);
  });
});

describe('changing a split', () => {
  it('lets only the owner change who is in it, and anyone add items', async () => {
    const owner = person('owner');
    const editor = person('editor');
    const { id } = await splitWith(owner, editor);
    expect((await change(editor, id, { op: 'addPerson', id: hex(), name: 'Guest' })).status).toBe(
      409,
    );

    const guest = hex();
    expect((await change(owner, id, { op: 'addPerson', id: guest, name: 'Guest' })).status).toBe(
      200,
    );
    const item = { id: hex(), name: 'Tea', cost: 10, payerId: guest, participantIds: [guest] };
    expect((await change(editor, id, { op: 'addItem', item })).status).toBe(200);
  });

  it('refuses a payer who is not in the split, and applies nothing from a refused batch', async () => {
    const owner = person('owner');
    const { id } = await splitWith(owner);
    const res = await change(
      owner,
      id,
      { op: 'addPerson', id: hex(), name: 'Amy' },
      {
        op: 'addItem',
        item: { id: hex(), name: 'X', cost: 5, payerId: hex(), participantIds: [] },
      },
    );
    expect(res.status).toBe(409);
    expect(res.data.index).toBe(1);
    expect((await api.call(owner, 'GET', `/api/splits/${id}`)).data.people).toEqual([]);
  });

  it('requires exact amounts to add up to the cost', async () => {
    const owner = person('owner');
    const { id } = await splitWith(owner);
    const a = hex();
    const b = hex();
    await change(
      owner,
      id,
      { op: 'addPerson', id: a, name: 'A' },
      { op: 'addPerson', id: b, name: 'B' },
    );
    const item = (exact: Record<string, number>) => ({
      op: 'addItem',
      item: {
        id: hex(),
        name: 'Dinner',
        cost: 30,
        payerId: a,
        participantIds: [a, b],
        splitMode: 'exact',
        exact,
      },
    });
    expect((await change(owner, id, item({ [a]: 10, [b]: 10 }))).status).toBe(409);
    expect((await change(owner, id, item({ [a]: 10, [b]: 20 }))).status).toBe(200);
  });
});

describe('share link invites', () => {
  it('gives an invite to accept rather than joining, and only one however often it is opened', async () => {
    const owner = person('owner');
    const amy = person('amy');
    const { id, token } = await splitWith(owner);

    const first = await api.call(amy, 'POST', `/api/join/${token}`);
    expect(first.data.status).toBe('invited');
    expect((await api.call(amy, 'GET', `/api/splits/${id}`)).status).toBe(404);
    const again = await api.call(amy, 'POST', `/api/join/${token}`);
    expect(again.data.inviteId).toBe(first.data.inviteId);
    expect((await api.call(amy, 'GET', '/api/invites')).data.invites).toHaveLength(1);

    // Owner opening their own link just goes in
    expect((await api.call(owner, 'POST', `/api/join/${token}`)).data.status).toBe('member');
  });

  it('accepting joins and adds them to the bill once; accepting again is refused', async () => {
    const owner = person('owner');
    const amy = person('amy');
    const { id, token } = await splitWith(owner);
    const { inviteId } = (await api.call(amy, 'POST', `/api/join/${token}`)).data;

    expect(
      (await api.call(person('other'), 'POST', `/api/invites/${inviteId}/accept`)).status,
    ).toBe(404);
    expect((await api.call(amy, 'POST', `/api/invites/${inviteId}/accept`)).data.id).toBe(id);
    const split = (await api.call(amy, 'GET', `/api/splits/${id}`)).data;
    expect(split.people.filter((p: { memberEmail: string }) => p.memberEmail === amy)).toHaveLength(
      1,
    );
    expect((await api.call(amy, 'POST', `/api/invites/${inviteId}/accept`)).status).toBe(404);
  });

  it('declining drops the invite; opening the link again gives a new one', async () => {
    const owner = person('owner');
    const ben = person('ben');
    const { id, token } = await splitWith(owner);
    const { inviteId } = (await api.call(ben, 'POST', `/api/join/${token}`)).data;

    expect((await api.call(ben, 'POST', `/api/invites/${inviteId}/decline`)).status).toBe(200);
    expect((await api.call(ben, 'GET', `/api/splits/${id}`)).status).toBe(404);
    expect((await api.call(ben, 'POST', `/api/invites/${inviteId}/accept`)).status).toBe(404);
    const fresh = await api.call(ben, 'POST', `/api/join/${token}`);
    expect(fresh.data.inviteId).not.toBe(inviteId);
  });

  it('resetting the link kills the old one and withdraws its invites', async () => {
    const owner = person('owner');
    const ben = person('ben');
    const { id, token } = await splitWith(owner);
    const { inviteId } = (await api.call(ben, 'POST', `/api/join/${token}`)).data;

    const reset = await api.call(owner, 'POST', `/api/splits/${id}/invite`);
    expect(reset.data.inviteToken).not.toBe(token);
    expect((await api.call(ben, 'POST', `/api/invites/${inviteId}/accept`)).status).toBe(404);
    expect((await api.call(ben, 'POST', `/api/join/${token}`)).status).toBe(404);
  });

  it('removing someone ends their access and changes the link', async () => {
    const owner = person('owner');
    const amy = person('amy');
    const { id, token } = await splitWith(owner, amy);

    expect((await api.call(owner, 'DELETE', `/api/splits/${id}/members/${amy}`)).status).toBe(200);
    expect((await api.call(amy, 'GET', `/api/splits/${id}`)).status).toBe(404);
    expect((await api.call(amy, 'POST', `/api/join/${token}`)).status).toBe(404);
    const split = (await api.call(owner, 'GET', `/api/splits/${id}`)).data;
    // Their place in the bill stays, as a guest
    expect(split.people.some((p: { memberEmail: string | null }) => p.memberEmail === amy)).toBe(
      false,
    );
    expect(split.people).toHaveLength(1);
  });
});

describe("sharing through a member's link", () => {
  /** A split with a member, and the link that member shares */
  async function shared() {
    const owner = person('owner');
    const member = person('member');
    const { id, token } = await splitWith(owner, member);
    const memberToken: string = (await api.call(member, 'GET', `/api/splits/${id}`)).data
      .inviteToken;
    return { owner, member, id, token, memberToken };
  }
  const invitesOf = async (who: string) =>
    (await api.call(who, 'GET', '/api/invites')).data.invites as {
      id: string;
      kind: string;
      email?: string;
      invitedBy: string;
    }[];

  it("asks the owner, once however often it's opened, and can't be accepted by the asker", async () => {
    const { owner, member, id, memberToken } = await shared();
    const cat = person('cat');
    const first = await api.call(cat, 'POST', `/api/join/${memberToken}`);
    expect(first.data).toMatchObject({ status: 'requested', id });
    const again = await api.call(cat, 'POST', `/api/join/${memberToken}`);
    expect(again.data.inviteId).toBe(first.data.inviteId);

    expect(await invitesOf(cat)).toMatchObject([{ kind: 'sent', owner }]);
    expect(await invitesOf(owner)).toMatchObject([
      { kind: 'request', email: cat, invitedBy: member },
    ]);
    // Only the owner sees it; the member who shared doesn't decide
    expect(await invitesOf(member)).toEqual([]);
    expect(
      (await api.call(member, 'POST', `/api/invites/${first.data.inviteId}/accept`)).status,
    ).toBe(404);
    expect((await api.call(cat, 'POST', `/api/invites/${first.data.inviteId}/accept`)).status).toBe(
      403,
    );
    expect((await api.call(cat, 'GET', `/api/splits/${id}`)).status).toBe(404);
  });

  it('approving lets them in and puts them in the bill; declining or withdrawing drops it', async () => {
    const { owner, id, memberToken } = await shared();
    const [cat, dan, eve] = [person('cat'), person('dan'), person('eve')];
    const catAsk = (await api.call(cat, 'POST', `/api/join/${memberToken}`)).data.inviteId;
    const danAsk = (await api.call(dan, 'POST', `/api/join/${memberToken}`)).data.inviteId;
    const eveAsk = (await api.call(eve, 'POST', `/api/join/${memberToken}`)).data.inviteId;

    expect((await api.call(owner, 'POST', `/api/invites/${catAsk}/accept`)).status).toBe(200);
    const split = (await api.call(cat, 'GET', `/api/splits/${id}`)).data;
    expect(split.role).toBe('editor');
    expect(split.people.some((p: { memberEmail: string }) => p.memberEmail === cat)).toBe(true);
    // Approving twice finds nothing to approve
    expect((await api.call(owner, 'POST', `/api/invites/${catAsk}/accept`)).status).toBe(404);

    expect((await api.call(owner, 'POST', `/api/invites/${danAsk}/decline`)).status).toBe(200);
    expect(await invitesOf(dan)).toEqual([]);
    expect((await api.call(eve, 'POST', `/api/invites/${eveAsk}/decline`)).status).toBe(200);
    expect(await invitesOf(owner)).toEqual([]);
  });

  it("turns into a plain invite when the owner's link is opened, and never back", async () => {
    const { owner, token, memberToken } = await shared();
    const cat = person('cat');
    const asked = (await api.call(cat, 'POST', `/api/join/${memberToken}`)).data;
    const invited = (await api.call(cat, 'POST', `/api/join/${token}`)).data;
    expect(invited).toMatchObject({ status: 'invited', inviteId: asked.inviteId });
    expect((await api.call(cat, 'POST', `/api/join/${memberToken}`)).data.status).toBe('invited');
    expect(await invitesOf(cat)).toMatchObject([{ kind: 'invite', invitedBy: owner }]);
    expect(await invitesOf(owner)).toEqual([]);
  });

  it("stops working when the member leaves, and resetting changes every member's link", async () => {
    const { owner, member, id, memberToken } = await shared();
    const other = person('other');
    const reset = await api.call(owner, 'POST', `/api/splits/${id}/invite`);
    expect(reset.status).toBe(200);
    expect((await api.call(other, 'POST', `/api/join/${memberToken}`)).status).toBe(404);
    const newToken = (await api.call(member, 'GET', `/api/splits/${id}`)).data.inviteToken;
    expect(newToken).not.toBe(memberToken);

    await api.call(member, 'DELETE', `/api/splits/${id}/members/${member}`);
    expect((await api.call(other, 'POST', `/api/join/${newToken}`)).status).toBe(404);
  });
});

describe('live updates', () => {
  // Without a sign-in header, local requests are DEV_USER_EMAIL; WebSockets can't send one
  const devUser = 'nobody@example.com';

  /** Opens the split's live channel as the dev user, collecting what it hears */
  function listen(id: string) {
    const ws = new WebSocket(`${api.base.replace(/^http/, 'ws')}/api/splits/${id}/ws`);
    const heard: { type: string; by: string | null }[] = [];
    ws.onmessage = (e) => heard.push(JSON.parse(String(e.data)));
    const opened = new Promise<void>((done, fail) => {
      ws.onopen = () => done();
      ws.onerror = () => fail(new Error('Could not connect'));
    });
    return { ws, heard, opened };
  }
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 50 && !check(); i++) await new Promise((r) => setTimeout(r, 100));
  };

  it('tells everyone with the split open about each saved change, and which tab made it', async () => {
    const member = person('member');
    const { id } = await splitWith(devUser, member);
    const payer = hex();
    await change(devUser, id, { op: 'addPerson', id: payer, name: 'Zed' });
    const live = listen(id);
    await live.opened;

    const item = { id: hex(), name: 'Tea', cost: 4, payerId: payer, participantIds: [payer] };
    await api.call(
      member,
      'POST',
      `/api/splits/${id}/changes`,
      { changes: [{ op: 'addItem', item }] },
      { 'X-Client-Id': 'tab-1' },
    );
    await api.call(member, 'PATCH', `/api/splits/${id}`, { name: 'Refused' });
    await api.call(devUser, 'PATCH', `/api/splits/${id}`, { name: 'Renamed' });
    await until(() => live.heard.length >= 2);
    // The refused rename (members can't) says nothing
    expect(live.heard).toEqual([
      { type: 'changed', by: 'tab-1' },
      { type: 'changed', by: null },
    ]);
    live.ws.close();
  });

  it('hears about people joining, and is only open to members', async () => {
    const { id, token } = await splitWith(devUser);
    const live = listen(id);
    await live.opened;
    const amy = person('amy');
    const { inviteId } = (await api.call(amy, 'POST', `/api/join/${token}`)).data;
    await api.call(amy, 'POST', `/api/invites/${inviteId}/accept`);
    await until(() => live.heard.length >= 2);
    expect(live.heard).toHaveLength(2);
    live.ws.close();

    const outsider = await api.call(person('outsider'), 'GET', `/api/splits/${id}/ws`);
    expect(outsider.status).toBe(404);
    const crossSite = await api.call(devUser, 'GET', `/api/splits/${id}/ws`, undefined, {
      Origin: 'https://evil.example',
    });
    expect(crossSite.status).toBe(403);
  });
});

describe('ordering my splits', () => {
  const myOrder = async (who: string) =>
    ((await api.call(who, 'GET', '/api/splits')).data.splits as { id: string }[]).map((s) => s.id);

  it('keeps each person their own order, with new splits first', async () => {
    const owner = person('owner');
    const member = person('member');
    const a = (await splitWith(owner, member)).id;
    const b = (await splitWith(owner, member)).id;
    const c = (await splitWith(owner)).id;
    expect(await myOrder(owner)).toEqual([c, b, a]);

    expect((await api.call(owner, 'PUT', '/api/splits/order', { ids: [a, c, b] })).status).toBe(
      200,
    );
    expect(await myOrder(owner)).toEqual([a, c, b]);
    // Someone else's order is theirs
    expect(await myOrder(member)).toEqual([b, a]);

    const d = (await splitWith(owner)).id;
    expect(await myOrder(owner)).toEqual([d, a, c, b]);
    // Ids of splits you're not in change nothing
    const outsider = person('outsider');
    await api.call(outsider, 'PUT', '/api/splits/order', { ids: [b, a] });
    expect(await myOrder(owner)).toEqual([d, a, c, b]);
    expect((await api.call(owner, 'PUT', '/api/splits/order', { ids: 'nope' })).status).toBe(400);
  });
});

describe('safeguards', () => {
  it('refuses changes started by another site', async () => {
    const owner = person('owner');
    const { token } = await splitWith(owner);
    const crossSite = { 'Sec-Fetch-Site': 'cross-site' };
    expect(
      (await api.call(person('x'), 'POST', `/api/join/${token}`, undefined, crossSite)).status,
    ).toBe(403);
    expect(
      (
        await api.call(
          owner,
          'POST',
          '/api/splits',
          { name: 'X', currency: 'MYR' },
          { Origin: 'https://evil.example' },
        )
      ).status,
    ).toBe(403);
    // Reads, and the app's own requests, are fine
    expect((await api.call(owner, 'GET', '/api/splits', undefined, crossSite)).status).toBe(200);
    expect(
      (await api.call(owner, 'GET', '/api/me', undefined, { 'Sec-Fetch-Site': 'same-origin' }))
        .status,
    ).toBe(200);
  });

  it('limits how many changes an account makes a minute, but never reading', async () => {
    const owner = person('busy');
    const { id } = await splitWith(owner);
    // Write until refused. The limit counts per minute window, and a run can straddle
    // two windows, so up to 130 writes: at least one window then sees more than 60.
    let accepted = 0;
    let refused = false;
    for (let i = 0; i < 130 && !refused; i++) {
      const { status } = await change(owner, id, { op: 'addPerson', id: hex(), name: `P${i}` });
      if (status === 429) refused = true;
      else if (status === 200) accepted++;
    }
    expect(refused).toBe(true);
    // One write went to creating the split, so at most 59 more fit in one window
    expect(accepted).toBeGreaterThanOrEqual(59);
    expect((await api.call(owner, 'GET', `/api/splits/${id}`)).status).toBe(200);
    // Someone else isn't held back
    expect((await splitWith(person('calm'))).id).toBeTruthy();
  });

  it('turns away request bodies that are too large', async () => {
    const res = await api.call(person('owner'), 'POST', '/api/splits', {
      name: 'x'.repeat(300_000),
      currency: 'MYR',
    });
    expect(res.status).toBe(413);
  });
});

describe('profile, pictures and photos', () => {
  // The smallest bytes that pass as a JPEG
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(64).fill(7)]);
  const upload = (who: string, method: string, path: string) =>
    api.call(who, method, path, jpeg, { 'Content-Type': 'image/jpeg' });

  it('saves the profile, settings and payment methods', async () => {
    const me = person('me');
    expect(
      (await api.call(me, 'PATCH', '/api/me', { displayName: 'Mei', settings: { theme: 'light' } }))
        .status,
    ).toBe(200);
    const methods = [{ id: hex(), type: 'DuitNow', detail: '012-345' }];
    const put = await api.call(me, 'PUT', '/api/me/payment-methods', {
      methods,
      preferredId: methods[0].id,
    });
    expect(put.status).toBe(200);
    const profile = (await api.call(me, 'GET', '/api/me')).data;
    expect(profile.displayName).toBe('Mei');
    expect(profile.settings.theme).toBe('light');
  });

  it("keeps a bank transfer's bank and account name, and lets cash go without details", async () => {
    const me = person('me');
    const friend = person('friend');
    const { id } = await splitWith(me, friend);
    const [bank, cash, wallet] = [hex(), hex(), hex()];
    const put = await api.call(me, 'PUT', '/api/me/payment-methods', {
      methods: [
        {
          id: bank,
          type: 'Bank transfer',
          detail: '5140 1234',
          bank: 'Kenanga',
          accountName: 'Mei Lin',
        },
        { id: cash, type: 'Cash', detail: '' },
        // A bank only belongs on a bank transfer
        { id: wallet, type: 'DuitNow', detail: '012-345', bank: 'Maybank' },
      ],
      preferredId: bank,
    });
    expect(put.data.error).toBeUndefined();
    expect(put.status).toBe(200);
    expect(put.data.paymentMethods).toEqual([
      {
        id: bank,
        type: 'Bank transfer',
        detail: '5140 1234',
        bank: 'Kenanga',
        accountName: 'Mei Lin',
      },
      { id: cash, type: 'Cash', detail: '', bank: null, accountName: null },
      { id: wallet, type: 'DuitNow', detail: '012-345', bank: null, accountName: null },
    ]);
    // People in a split with you see the same
    const members = (await api.call(friend, 'GET', `/api/splits/${id}`)).data.members as {
      email: string;
      paymentMethods: { bank: string | null }[];
    }[];
    expect(members.find((m) => m.email === me)?.paymentMethods[0].bank).toBe('Kenanga');

    const missing = await api.call(me, 'PUT', '/api/me/payment-methods', {
      methods: [{ id: hex(), type: 'DuitNow', detail: '' }],
    });
    expect(missing.status).toBe(400);
  });

  it('shows a profile picture only to people who share a split, and refuses non-images', async () => {
    const me = person('me');
    const friend = person('friend');
    expect((await upload(me, 'PUT', '/api/me/avatar')).status).toBe(200);
    const path = `/api/avatars/${encodeURIComponent(me)}`;
    expect((await api.call(me, 'GET', path)).status).toBe(200);
    expect((await api.call(friend, 'GET', path)).status).toBe(404);
    await splitWith(me, friend);
    expect((await api.call(friend, 'GET', path)).status).toBe(200);
    const bad = await api.call(me, 'PUT', '/api/me/avatar', 'not an image', {
      'Content-Type': 'text/plain',
    });
    expect(bad.status).toBe(415);
  });

  it('lets members add photos and see the split picture, and only the owner change it', async () => {
    const owner = person('owner');
    const editor = person('editor');
    const stranger = person('stranger');
    const { id } = await splitWith(owner, editor);

    const added = await upload(editor, 'POST', `/api/splits/${id}/attachments`);
    expect(added.status).toBe(201);
    expect(
      (await api.call(owner, 'GET', `/api/splits/${id}/attachments/${added.data.id}`)).status,
    ).toBe(200);
    expect(
      (await api.call(stranger, 'GET', `/api/splits/${id}/attachments/${added.data.id}`)).status,
    ).toBe(404);

    expect((await upload(editor, 'PUT', `/api/splits/${id}/picture`)).status).toBe(403);
    expect((await upload(owner, 'PUT', `/api/splits/${id}/picture`)).status).toBe(200);
    expect((await api.call(editor, 'GET', `/api/splits/${id}/picture`)).status).toBe(200);

    expect((await api.call(owner, 'PATCH', `/api/splits/${id}`, { name: 'Renamed' })).status).toBe(
      200,
    );
    expect((await api.call(editor, 'GET', `/api/splits/${id}`)).data.name).toBe('Renamed');
  });

  it('answers unknown API paths with a JSON 404', async () => {
    const res = await api.call(person('x'), 'GET', '/api/nope');
    expect(res.status).toBe(404);
    expect(res.data.error).toBe('Not found');
  });
});

describe('exchange rates', () => {
  it('converts with Wise, falls back to Frankfurter, and says when neither has a rate', async () => {
    const me = person('me');
    api.rates.set('USD', 'MYR', 4.2);
    const res = await api.call(me, 'GET', '/api/rates?from=usd&to=MYR&amount=10.5');
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ from: 'USD', to: 'MYR', rate: 4.2, source: 'wise' });
    expect(res.data.convertedCents).toBe(4410);

    api.rates.set('SGD', 'MYR', 3.3);
    api.rates.down('wise', true);
    const fallback = await api.call(me, 'GET', '/api/rates?from=SGD&to=MYR');
    api.rates.down('wise', false);
    expect(fallback.data).toMatchObject({ rate: 3.3, source: 'frankfurter' });

    expect((await api.call(me, 'GET', '/api/rates?from=XXX&to=MYR')).status).toBe(503);
  });

  it('refuses bad currency codes and amounts', async () => {
    const me = person('me');
    expect((await api.call(me, 'GET', '/api/rates?from=US&to=MYR')).status).toBe(400);
    expect((await api.call(me, 'GET', '/api/rates?from=USD&to=MYR&amount=-1')).status).toBe(400);
    expect((await api.call(me, 'GET', '/api/rates?from=USD&to=MYR&amount=abc')).status).toBe(400);
  });
});

describe('items in another currency', () => {
  /** A MYR split with two people, A paying */
  async function myrSplit() {
    const owner = person('owner');
    const { id } = await splitWith(owner);
    const [a, b] = [hex(), hex()];
    await change(
      owner,
      id,
      { op: 'addPerson', id: a, name: 'A' },
      { op: 'addPerson', id: b, name: 'B' },
    );
    const item = (extra: Record<string, unknown>) => ({
      id: hex(),
      name: 'Ramen',
      cost: 999, // what the app previewed; the server works it out itself
      payerId: a,
      participantIds: [a, b],
      ...extra,
    });
    const items = async () => (await api.call(owner, 'GET', `/api/splits/${id}`)).data.items;
    return { owner, id, a, b, item, items };
  }

  it('converts at the fetched rate and keeps what was typed', async () => {
    const { owner, id, item, items } = await myrSplit();
    api.rates.set('JPY', 'MYR', 0.03);
    const ramen = item({ original: { currency: 'JPY', amount: 1000 } });
    expect((await change(owner, id, { op: 'addItem', item: ramen })).status).toBe(200);
    const [saved] = await items();
    expect(saved.cost).toBe(30);
    expect(saved.original).toMatchObject({
      currency: 'JPY',
      amount: 1000,
      rate: 0.03,
      rateSource: 'wise',
    });
  });

  it('keeps the saved rate when an edit leaves the amount alone, and reconverts when it changes', async () => {
    const { owner, id, item, items } = await myrSplit();
    api.rates.set('KRW', 'MYR', 0.0034);
    const bbq = item({ name: 'BBQ', original: { currency: 'KRW', amount: 50000 } });
    await change(owner, id, { op: 'addItem', item: bbq });
    expect((await items())[0].cost).toBe(170);

    // Wait out the cached rate isn't needed: an unchanged amount never asks for one
    api.rates.set('KRW', 'MYR', 0.01);
    await change(owner, id, { op: 'updateItem', item: { ...bbq, name: 'Korean BBQ' } });
    expect((await items())[0]).toMatchObject({ name: 'Korean BBQ', cost: 170 });
  });

  it('uses a rate people type in', async () => {
    const { owner, id, item, items } = await myrSplit();
    const card = item({
      original: { currency: 'THB', amount: 300, rate: 0.13, rateSource: 'manual' },
    });
    expect((await change(owner, id, { op: 'addItem', item: card })).status).toBe(200);
    expect((await items())[0]).toMatchObject({
      cost: 39,
      original: { rate: 0.13, rateSource: 'manual' },
    });
    const bad = item({ original: { currency: 'THB', amount: 300, rate: 0, rateSource: 'manual' } });
    expect((await change(owner, id, { op: 'addItem', item: bad })).status).toBe(409);
  });

  it('splits exact amounts typed in the other currency so they still add up', async () => {
    const { owner, id, a, b, item, items } = await myrSplit();
    // A pair no other test uses, so no cached rate gets in the way
    api.rates.set('HKD', 'MYR', 3.33);
    const dinner = item({
      splitMode: 'exact',
      original: { currency: 'HKD', amount: 10, exact: { [a]: 3.33, [b]: 6.67 } },
    });
    expect((await change(owner, id, { op: 'addItem', item: dinner })).status).toBe(200);
    const [saved] = await items();
    expect(saved.cost).toBe(33.3);
    expect(Math.round((saved.exact[a] + saved.exact[b]) * 100)).toBe(3330);
    expect(saved.original.exact).toEqual({ [a]: 3.33, [b]: 6.67 });
  });

  it('answers 503 and saves nothing when no rate can be had', async () => {
    const { owner, id, item, items } = await myrSplit();
    const lunch = item({ original: { currency: 'ZZZ', amount: 5 } });
    expect((await change(owner, id, { op: 'addItem', item: lunch })).status).toBe(503);
    expect(await items()).toEqual([]);
  });

  it('treats an item in the split currency as a plain one', async () => {
    const { owner, id, item, items } = await myrSplit();
    await change(owner, id, {
      op: 'addItem',
      item: item({ cost: 12, original: { currency: 'MYR', amount: 12 } }),
    });
    expect((await items())[0]).toMatchObject({ cost: 12, original: null });
  });
});

describe("a currency's rate across the split", () => {
  async function phpSplit() {
    const owner = person('owner');
    const editor = person('editor');
    const { id } = await splitWith(owner, editor);
    const [a, b] = [hex(), hex()];
    await change(
      owner,
      id,
      { op: 'addPerson', id: a, name: 'A' },
      { op: 'addPerson', id: b, name: 'B' },
    );
    const item = (extra: Record<string, unknown>) => ({
      id: hex(),
      name: 'Jeepney',
      cost: 0,
      payerId: a,
      participantIds: [a, b],
      ...extra,
    });
    const items = async () =>
      (await api.call(owner, 'GET', `/api/splits/${id}`)).data.items as {
        name: string;
        cost: number;
        exact: Record<string, number>;
        original: { rate: number; rateSource: string };
      }[];
    return { owner, editor, id, a, b, item, items };
  }

  it('puts every item in a currency on a typed rate, exact splits included, then back on the live one', async () => {
    const { owner, id, a, b, item, items } = await phpSplit();
    api.rates.set('PHP', 'MYR', 0.08);
    await change(
      owner,
      id,
      { op: 'addItem', item: item({ name: 'Taxi', original: { currency: 'PHP', amount: 1000 } }) },
      {
        op: 'addItem',
        item: item({
          name: 'Dinner',
          splitMode: 'exact',
          original: { currency: 'PHP', amount: 10, exact: { [a]: 3.33, [b]: 6.67 } },
        }),
      },
    );
    expect((await items()).map((i) => i.cost)).toEqual([80, 0.8]);

    expect((await change(owner, id, { op: 'setRate', currency: 'PHP', rate: 0.1 })).status).toBe(
      200,
    );
    const typed = await items();
    expect(typed.map((i) => i.cost)).toEqual([100, 1]);
    expect(typed.every((i) => i.original.rateSource === 'manual')).toBe(true);
    expect(Math.round((typed[1].exact[a] + typed[1].exact[b]) * 100)).toBe(100);

    // Refreshing leaves typed rates alone; asking for the live rate replaces them
    await change(owner, id, { op: 'refreshRates', currencies: ['PHP'] });
    expect((await items()).map((i) => i.cost)).toEqual([100, 1]);
    await change(owner, id, { op: 'setRate', currency: 'PHP', rate: null });
    const live = await items();
    expect(live.map((i) => i.cost)).toEqual([80, 0.8]);
    expect(live.every((i) => i.original.rateSource === 'wise')).toBe(true);
  });

  it('lets any member change rates, refuses bad ones, and answers 503 when no rate can be had', async () => {
    const { owner, editor, id, item, items } = await phpSplit();
    await change(owner, id, {
      op: 'addItem',
      item: item({
        original: { currency: 'VND', amount: 100000, rate: 0.0002, rateSource: 'manual' },
      }),
    });
    expect(
      (await change(editor, id, { op: 'setRate', currency: 'VND', rate: 0.0003 })).status,
    ).toBe(200);
    expect((await items())[0].cost).toBe(30);
    expect((await change(owner, id, { op: 'setRate', currency: 'VND', rate: 0 })).status).toBe(409);
    expect((await change(owner, id, { op: 'setRate', currency: 'MYR', rate: 1 })).status).toBe(409);
    // Nothing to fetch when every item is on a typed rate
    expect((await change(owner, id, { op: 'refreshRates', currencies: ['VND'] })).status).toBe(200);
    // No VND rate anywhere: the change waits rather than failing
    expect((await change(owner, id, { op: 'setRate', currency: 'VND', rate: null })).status).toBe(
      503,
    );
    expect((await items())[0].cost).toBe(30);
  });
});

describe('changing a split currency', () => {
  /** Opens the split until its items are converted, or gives up after a few seconds */
  async function waitConverted(who: string, id: string) {
    for (let i = 0; i < 40; i++) {
      const split = (await api.call(who, 'GET', `/api/splits/${id}`)).data;
      if (!split.converting) return split;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error('Still converting');
  }

  it('converts every item in the background, and changing back restores them exactly', async () => {
    const owner = person('owner');
    const { id } = await splitWith(owner);
    const [a, b] = [hex(), hex()];
    await change(
      owner,
      id,
      { op: 'addPerson', id: a, name: 'A' },
      { op: 'addPerson', id: b, name: 'B' },
    );
    api.rates.set('JPY', 'MYR', 0.03);
    const plain = {
      id: hex(),
      name: 'Taxi',
      cost: 10,
      payerId: a,
      participantIds: [a, b],
      splitMode: 'exact',
      exact: { [a]: 3, [b]: 7 },
    };
    const yen = {
      id: hex(),
      name: 'Sushi',
      cost: 0,
      payerId: a,
      participantIds: [a, b],
      original: { currency: 'JPY', amount: 1000 },
    };
    await change(owner, id, { op: 'addItem', item: plain }, { op: 'addItem', item: yen });

    api.rates.set('MYR', 'EUR', 0.2);
    api.rates.set('JPY', 'EUR', 0.006);
    const patched = await api.call(owner, 'PATCH', `/api/splits/${id}`, { currency: 'EUR' });
    expect(patched.data.converting).toBe(true);
    let split = await waitConverted(owner, id);
    const byName = (name: string) => split.items.find((i: { name: string }) => i.name === name);
    expect(split.currency).toBe('EUR');
    expect(byName('Taxi')).toMatchObject({
      cost: 2,
      original: { currency: 'MYR', amount: 10, rate: 0.2 },
    });
    expect(Math.round((byName('Taxi').exact[a] + byName('Taxi').exact[b]) * 100)).toBe(200);
    expect(byName('Sushi')).toMatchObject({ cost: 6, original: { currency: 'JPY', amount: 1000 } });

    await api.call(owner, 'PATCH', `/api/splits/${id}`, { currency: 'MYR' });
    split = await waitConverted(owner, id);
    expect(byName('Taxi')).toMatchObject({ cost: 10, original: null, exact: { [a]: 3, [b]: 7 } });
    expect(byName('Sushi')).toMatchObject({
      cost: 30,
      original: { currency: 'JPY', amount: 1000 },
    });
  });

  it('holds item changes until converted, and finishes once rates are back', async () => {
    const owner = person('owner');
    const { id } = await splitWith(owner);
    const a = hex();
    await change(owner, id, { op: 'addPerson', id: a, name: 'A' });
    await change(owner, id, {
      op: 'addItem',
      item: { id: hex(), name: 'Tea', cost: 10, payerId: a, participantIds: [a] },
    });

    api.rates.down('wise', true);
    api.rates.down('frankfurter', true);
    await api.call(owner, 'PATCH', `/api/splits/${id}`, { currency: 'GBP' });
    expect((await api.call(owner, 'GET', `/api/splits/${id}`)).data.converting).toBe(true);
    const held = await change(owner, id, {
      op: 'addItem',
      item: { id: hex(), name: 'Cake', cost: 5, payerId: a, participantIds: [a] },
    });
    expect(held.status).toBe(503);

    api.rates.down('wise', false);
    api.rates.down('frankfurter', false);
    api.rates.set('MYR', 'GBP', 0.17);
    const split = await waitConverted(owner, id);
    expect(split.items[0]).toMatchObject({ cost: 1.7, original: { currency: 'MYR', amount: 10 } });
  });
});
