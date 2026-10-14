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
