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
    expect((await api.call(editor, 'GET', `/api/splits/${id}`)).data.inviteToken).toBeUndefined();
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
