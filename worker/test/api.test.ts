// The API end to end, against the real Worker and a fresh local database: who can see
// and change what, the rules for changing a split, and the share-link invite flows.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { LocalWorker } from './local-worker';
import { startLocalWorker } from './local-worker';
import { MAX_CHANGES } from '../../shared/api';
import { MAX_ITEMS } from '../../shared/types';
import { rateDay } from '../../shared/rates';

let api: LocalWorker;
let n = 0;
// Fresh accounts for each test, so tests don't see each other's splits
const person = (name: string) => `${name}${++n}@example.com`;
const hex = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

// Within the harness's own limits: migrations, then the Worker starting
beforeAll(async () => {
  api = await startLocalWorker();
}, 180_000);

// Each test sets the rates it needs
afterEach(() => api.rates.reset());

afterAll(() => api?.stop(), 30_000);

/** A split owned by `owner`, with `members` already in it through the share link */
async function splitWith(owner: string, ...members: string[]) {
  const { data } = await api.call(owner, 'POST', '/api/splits', {
    id: hex(),
    name: 'Trip',
    currency: 'MYR',
  });
  const id: string = data.id;
  const token: string = (await api.call(owner, 'GET', `/api/splits/${id}`)).data.shareToken;
  for (const m of members) {
    const opened = await api.call(m, 'POST', `/api/join/${token}`);
    await api.call(m, 'POST', `/api/invites/${opened.data.inviteId}/accept`);
  }
  return { id, token };
}

const change = (who: string, id: string, ...changes: unknown[]) =>
  api.call(who, 'POST', `/api/splits/${id}/changes`, { changes });

// The smallest bytes that pass as a JPEG
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(64).fill(7)]);
const upload = (who: string, method: string, path: string) =>
  api.call(who, method, path, jpeg, { 'Content-Type': 'image/jpeg' });

/** The person in a split's bill who is `email` */
const personOf = async (who: string, id: string, email: string): Promise<string> =>
  (await api.call(who, 'GET', `/api/splits/${id}`)).data.people.find(
    (p: { memberEmail: string | null }) => p.memberEmail === email,
  ).id;

/** How split `id` shows in `who`'s My splits */
const listed = async (who: string, id: string) =>
  ((await api.call(who, 'GET', '/api/splits')).data.splits as Record<string, unknown>[]).find(
    (s) => s.id === id,
  );

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
    // Nobody removes the owner, whatever their role
    for (const who of [editor, owner]) {
      const removeOwner = await api.call(who, 'DELETE', `/api/splits/${id}/members/${owner}`);
      expect(removeOwner.status).toBe(400);
      expect(removeOwner.data.error).toBe('The owner cannot be removed');
    }
    expect((await api.call(owner, 'GET', `/api/splits/${id}`)).data.role).toBe('owner');
    // Members share with a link of their own, never the owner's
    const ownToken = (await api.call(editor, 'GET', `/api/splits/${id}`)).data.shareToken;
    const ownerToken = (await api.call(owner, 'GET', `/api/splits/${id}`)).data.shareToken;
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
      403,
    );

    const guest = hex();
    expect((await change(owner, id, { op: 'addPerson', id: guest, name: 'Guest' })).status).toBe(
      200,
    );
    const item = { id: hex(), name: 'Tea', cost: 10, payerId: guest, participantIds: [guest] };
    expect((await change(editor, id, { op: 'addItem', item })).status).toBe(200);
  });

  it('refuses a payer who is not in the split', async () => {
    const owner = person('owner');
    const { id } = await splitWith(owner);
    const amy = hex();
    await change(owner, id, { op: 'addPerson', id: amy, name: 'Amy' });
    // Everything else about the item is fine, so the payer is what's refused
    const res = await change(owner, id, {
      op: 'addItem',
      item: { id: hex(), name: 'X', cost: 5, payerId: hex(), participantIds: [amy] },
    });
    expect(res.status).toBe(409);
    expect(res.data.error).toBe('Who paid must be someone in this split');
    expect((await api.call(owner, 'GET', `/api/splits/${id}`)).data.items).toEqual([]);
  });

  it('applies nothing from a batch when one change in it is refused', async () => {
    const owner = person('owner');
    const { id } = await splitWith(owner);
    const amy = hex();
    const res = await change(
      owner,
      id,
      { op: 'addPerson', id: amy, name: 'Amy' },
      {
        op: 'addItem',
        item: { id: hex(), name: 'X', cost: 5, payerId: hex(), participantIds: [amy] },
      },
    );
    expect(res.status).toBe(409);
    // Amy, added first and fine on her own, isn't saved either
    expect((await api.call(owner, 'GET', `/api/splits/${id}`)).data.people).toEqual([]);
  });

  it(`takes up to ${MAX_CHANGES} changes in one request, all applied, and refuses more`, async () => {
    const owner = person('owner');
    const { id } = await splitWith(owner);
    const amy = hex();
    await change(owner, id, { op: 'addPerson', id: amy, name: 'Amy' });
    const renames = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ op: 'renamePerson', id: amy, name: `Amy ${i + 1}` }));

    expect((await change(owner, id, ...renames(MAX_CHANGES))).status).toBe(200);
    const people = async () => (await api.call(owner, 'GET', `/api/splits/${id}`)).data.people;
    expect((await people())[0].name).toBe(`Amy ${MAX_CHANGES}`);

    const tooMany = await change(owner, id, ...renames(MAX_CHANGES + 1));
    expect(tooMany.status).toBe(400);
    expect(tooMany.data.error).toBe(`Send 1-${MAX_CHANGES} changes`);
    // None of them applied
    expect((await people())[0].name).toBe(`Amy ${MAX_CHANGES}`);
  });

  it(`holds up to ${MAX_ITEMS} items, so its totals stay exact, and refuses more`, async () => {
    const owner = person('owner');
    const { id } = await splitWith(owner);
    const amy = hex();
    await change(owner, id, { op: 'addPerson', id: amy, name: 'Amy' });
    const tea = () => ({
      op: 'addItem',
      item: { id: hex(), name: 'Tea', cost: 1, payerId: amy, participantIds: [amy] },
    });
    for (let added = 0; added < MAX_ITEMS; added += MAX_CHANGES) {
      const n = Math.min(MAX_CHANGES, MAX_ITEMS - added);
      expect((await change(owner, id, ...Array.from({ length: n }, tea))).status).toBe(200);
    }
    const more = await change(owner, id, tea());
    expect(more.status).toBe(409);
    expect(more.data.error).toBe(
      `A split can have up to ${MAX_ITEMS.toLocaleString('en-US')} items`,
    );
    expect((await api.call(owner, 'GET', `/api/splits/${id}`)).data.items).toHaveLength(MAX_ITEMS);
  }, 60_000);

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

  it('keeps how many shares each person has in an item split by shares', async () => {
    const owner = person('owner');
    const { id } = await splitWith(owner);
    const [a, b, itemId] = [hex(), hex(), hex()];
    const item = (shares: Record<string, number>) => ({
      id: itemId,
      name: 'Rent',
      cost: 40,
      payerId: a,
      participantIds: [a, b],
      splitMode: 'shares',
      shares,
    });
    expect(
      (
        await change(
          owner,
          id,
          { op: 'addPerson', id: a, name: 'A' },
          { op: 'addPerson', id: b, name: 'B' },
          { op: 'addItem', item: item({ [a]: 1, [b]: 3 }) },
        )
      ).status,
    ).toBe(200);
    const saved = async () => (await api.call(owner, 'GET', `/api/splits/${id}`)).data.items[0];
    expect(await saved()).toMatchObject({ splitMode: 'shares', shares: { [a]: 1, [b]: 3 } });

    expect(
      (await change(owner, id, { op: 'updateItem', item: item({ [a]: 2, [b]: 1 }) })).status,
    ).toBe(200);
    expect((await saved()).shares).toEqual({ [a]: 2, [b]: 1 });
    // Each share is a whole number of at least one
    expect(
      (await change(owner, id, { op: 'updateItem', item: item({ [a]: 0, [b]: 1 }) })).status,
    ).toBe(409);
    expect((await saved()).shares).toEqual({ [a]: 2, [b]: 1 });
  });

  it('moves an item to another day, but not to one still to come', async () => {
    const owner = person('owner');
    const { id } = await splitWith(owner);
    const a = hex();
    const itemId = hex();
    await change(
      owner,
      id,
      { op: 'addPerson', id: a, name: 'A' },
      {
        op: 'addItem',
        item: { id: itemId, name: 'Dinner', cost: 30, payerId: a, participantIds: [a] },
      },
    );
    const lastWeek = Date.now() - 7 * 864e5;
    expect(
      (await change(owner, id, { op: 'setItemDate', id: itemId, createdAt: lastWeek })).status,
    ).toBe(200);
    expect((await api.call(owner, 'GET', `/api/splits/${id}`)).data.items[0].createdAt).toBe(
      lastWeek,
    );
    const nextMonth = Date.now() + 30 * 864e5;
    expect(
      (await change(owner, id, { op: 'setItemDate', id: itemId, createdAt: nextMonth })).status,
    ).toBe(409);
    // Gone already (someone removed it): nothing to move, and nothing refused
    expect(
      (await change(owner, id, { op: 'setItemDate', id: hex(), createdAt: lastWeek })).status,
    ).toBe(200);
  });

  it('lets others link only themselves to a person, and never over someone else', async () => {
    const owner = person('owner');
    const editor = person('editor');
    const { id } = await splitWith(owner, editor);
    const guest = hex();
    await change(owner, id, { op: 'addPerson', id: guest, name: 'Guest' });
    const link = (who: string, personId: string, memberEmail: string | null) =>
      change(who, id, { op: 'linkPerson', id: personId, memberEmail });

    expect((await link(editor, guest, owner)).status).toBe(403);
    const editorPerson = await personOf(owner, id, editor);
    expect((await link(owner, editorPerson, owner)).status).toBe(409);
    // Moving their own link from the person they joined as to the guest
    const moved = await change(
      editor,
      id,
      { op: 'linkPerson', id: editorPerson, memberEmail: null },
      { op: 'linkPerson', id: guest, memberEmail: editor },
    );
    expect(moved.status).toBe(200);
    expect(await personOf(owner, id, editor)).toBe(guest);
  });

  it('removes a person only when no item depends on them', async () => {
    const owner = person('owner');
    const { id } = await splitWith(owner);
    const [a, b, c, d] = [hex(), hex(), hex(), hex()];
    const item = (participantIds: string[], extra = {}) => ({
      op: 'addItem',
      item: { id: hex(), name: 'X', cost: 10, payerId: a, participantIds, ...extra },
    });
    await change(
      owner,
      id,
      ...[a, b, c, d].map((p, i) => ({ op: 'addPerson', id: p, name: `P${i}` })),
      item([a, b]),
      item([c]),
      item([a, d], { splitMode: 'exact', exact: { [a]: 5, [d]: 5 } }),
    );
    const remove = async (personId: string, fromItems?: boolean) => {
      const res = await change(owner, id, { op: 'removePerson', id: personId, fromItems });
      return res.status === 200 ? 'removed' : res.data.error;
    };

    expect(await remove(a, true)).toMatch(/paid for 3 items/);
    expect(await remove(b)).toMatch(/is on 1 item/);
    expect(await remove(c, true)).toMatch(/only person/);
    expect(await remove(d, true)).toMatch(/exact amounts/);
    expect(await remove(b, true)).toBe('removed');
    const items = (await api.call(owner, 'GET', `/api/splits/${id}`)).data.items;
    expect(items[0].participantIds).toEqual([a]);
  });

  it('clears people only once there are no items, taking away their access', async () => {
    const owner = person('owner');
    const editor = person('editor');
    const { id } = await splitWith(owner, editor);
    const p = await personOf(owner, id, editor);
    const item = { id: hex(), name: 'Tea', cost: 4, payerId: p, participantIds: [p] };
    await change(owner, id, { op: 'addItem', item });

    expect((await change(owner, id, { op: 'clearPeople' })).status).toBe(409);
    expect((await change(owner, id, { op: 'clearItems' }, { op: 'clearPeople' })).status).toBe(200);
    expect((await api.call(editor, 'GET', `/api/splits/${id}`)).status).toBe(404);
  });

  it("refuses renaming someone whose name comes from their account, or a distributor who isn't in it", async () => {
    const owner = person('owner');
    const editor = person('editor');
    const { id } = await splitWith(owner, editor);
    const p = await personOf(owner, id, editor);
    expect((await change(owner, id, { op: 'renamePerson', id: p, name: 'Nick' })).status).toBe(409);
    expect((await change(owner, id, { op: 'setDistributor', personId: hex() })).status).toBe(409);
    expect((await change(owner, id, { op: 'setDistributor', personId: p })).status).toBe(200);
  });

  it("removes an item's photos with it", async () => {
    const owner = person('owner');
    const { id } = await splitWith(owner);
    const [p, itemId] = [hex(), hex()];
    await change(
      owner,
      id,
      { op: 'addPerson', id: p, name: 'P' },
      { op: 'addItem', item: { id: itemId, name: 'X', cost: 1, payerId: p, participantIds: [p] } },
    );
    const photo = await upload(owner, 'POST', `/api/splits/${id}/attachments?itemId=${itemId}`);
    expect(photo.status).toBe(201);

    expect((await change(owner, id, { op: 'removeItem', id: itemId })).status).toBe(200);
    expect(
      (await api.call(owner, 'GET', `/api/splits/${id}/attachments/${photo.data.id}`)).status,
    ).toBe(404);
  });

  it('keeps notes on items, line breaks included, and limits their length', async () => {
    const owner = person('owner');
    const { id } = await splitWith(owner);
    const a = hex();
    const itemId = hex();
    await change(owner, id, { op: 'addPerson', id: a, name: 'A' });
    const item = (notes: unknown) => ({
      id: itemId,
      name: 'Dinner',
      cost: 30,
      payerId: a,
      participantIds: [a],
      notes,
    });
    expect(
      (await change(owner, id, { op: 'addItem', item: item('  Two mains\nOne dessert  ') })).status,
    ).toBe(200);
    const notesOf = async () =>
      (await api.call(owner, 'GET', `/api/splits/${id}`)).data.items[0].notes;
    expect(await notesOf()).toBe('Two mains\nOne dessert');
    expect(
      (await change(owner, id, { op: 'updateItem', item: item('x'.repeat(2001)) })).status,
    ).toBe(409);
    expect((await change(owner, id, { op: 'updateItem', item: item('   ') })).status).toBe(200);
    expect(await notesOf()).toBeNull();
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
    const newToken: string = reset.data.shareToken;
    expect(newToken).toEqual(expect.any(String));
    expect(newToken).not.toBe(token);
    expect((await api.call(ben, 'POST', `/api/invites/${inviteId}/accept`)).status).toBe(404);
    expect((await api.call(ben, 'POST', `/api/join/${token}`)).status).toBe(404);

    // The new link is the one the split now shows, and it works
    expect((await api.call(owner, 'GET', `/api/splits/${id}`)).data.shareToken).toBe(newToken);
    const opened = await api.call(ben, 'POST', `/api/join/${newToken}`);
    expect(opened.data).toMatchObject({ status: 'invited', id });
    expect(opened.data.inviteId).not.toBe(inviteId);
    expect(
      (await api.call(ben, 'POST', `/api/invites/${opened.data.inviteId}/accept`)).status,
    ).toBe(200);
    expect((await api.call(ben, 'GET', `/api/splits/${id}`)).status).toBe(200);
  });

  it("doesn't let one member remove another, who keeps their access", async () => {
    const owner = person('owner');
    const [amy, ben] = [person('amy'), person('ben')];
    const { id } = await splitWith(owner, amy, ben);

    const res = await api.call(amy, 'DELETE', `/api/splits/${id}/members/${ben}`);
    expect(res.status).toBe(403);
    expect(res.data.error).toBe('Only the owner can remove members');
    const split = await api.call(ben, 'GET', `/api/splits/${id}`);
    expect(split.status).toBe(200);
    expect(split.data.role).toBe('editor');
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
      .shareToken;
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
    const newToken = (await api.call(member, 'GET', `/api/splits/${id}`)).data.shareToken;
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

  it('closes the channel of someone taken out of the split', async () => {
    const owner = person('owner');
    const { id } = await splitWith(owner, devUser);
    const live = listen(id);
    await live.opened;

    await api.call(owner, 'DELETE', `/api/splits/${id}/members/${devUser}`);
    // The room has sent its close: the channel is closing or closed
    await until(() => live.ws.readyState >= WebSocket.CLOSING);
    expect(live.ws.readyState).toBeGreaterThanOrEqual(WebSocket.CLOSING);
  });
});

describe('My splits', () => {
  it('adds up each split, and where the person asking stands in it', async () => {
    const owner = person('owner');
    const member = person('member');
    const { id } = await splitWith(owner, member);
    const me = hex();
    const ben = hex();
    await change(
      owner,
      id,
      { op: 'addPerson', id: me, name: 'Me' },
      { op: 'linkPerson', id: me, memberEmail: owner },
      { op: 'addPerson', id: ben, name: 'Ben' },
    );
    const them = await personOf(owner, id, member);
    const res = await change(
      owner,
      id,
      // 90 shared by three, paid by the member: 30 each
      {
        op: 'addItem',
        item: {
          id: hex(),
          name: 'Dinner',
          cost: 90,
          payerId: them,
          participantIds: [me, them, ben],
        },
      },
      // 10 paid by the owner: 4 theirs, 6 the member's
      {
        op: 'addItem',
        item: {
          id: hex(),
          name: 'Taxi',
          cost: 10,
          payerId: me,
          participantIds: [me, them],
          splitMode: 'exact',
          exact: { [me]: 4, [them]: 6 },
        },
      },
    );
    expect(res.status).toBe(200);

    // The owner paid 10 and owes 30 + 4; the member paid 90 and owes 30 + 6
    expect(await listed(owner, id)).toMatchObject({
      totalCents: 10_000,
      peopleCount: 3,
      myBalanceCents: -2400,
    });
    expect(await listed(member, id)).toMatchObject({ myBalanceCents: 5400 });
    // Nobody in the bill is this account yet
    const empty = (await splitWith(owner)).id;
    expect(await listed(owner, empty)).toMatchObject({
      totalCents: 0,
      peopleCount: 0,
      myBalanceCents: null,
    });
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

describe('archiving and search', () => {
  it('archives a split for one person only', async () => {
    const owner = person('owner');
    const member = person('member');
    const { id } = await splitWith(owner, member);
    expect(await listed(owner, id)).toMatchObject({
      archived: false,
      settled: false,
      itemCount: 0,
    });

    expect((await api.call(owner, 'PUT', '/api/archived', { id, archived: true })).status).toBe(
      200,
    );
    expect(await listed(owner, id)).toMatchObject({ archived: true });
    expect(await listed(member, id)).toMatchObject({ archived: false });
    await api.call(owner, 'PUT', '/api/archived', { id, archived: false });
    expect(await listed(owner, id)).toMatchObject({ archived: false });

    // Only splits you're in, and only a yes or no
    const outsider = person('outsider');
    expect((await api.call(outsider, 'PUT', '/api/archived', { id, archived: true })).status).toBe(
      404,
    );
    expect((await api.call(owner, 'PUT', '/api/archived', { id, archived: 'yes' })).status).toBe(
      400,
    );
  });

  // Each bill is 30, paid by one person in the split for everyone in it
  it.each<[string, number, number[], Record<string, unknown>]>([
    ['one person paid for themselves', 1, [0], { settled: true, itemCount: 1, totalCents: 3000 }],
    // The other two owe the first 10 each
    ['one of three paid for all', 3, [0], { settled: false, itemCount: 1, totalCents: 3000 }],
    ['each of three paid for all', 3, [0, 1, 2], { settled: true, itemCount: 3, totalCents: 9000 }],
  ])('says whether a split is settled when %s', async (_bills, count, payers, expected) => {
    const owner = person('owner');
    const { id } = await splitWith(owner);
    const people = Array.from({ length: count }, hex);
    const res = await change(
      owner,
      id,
      ...people.map((p, i) => ({ op: 'addPerson', id: p, name: `P${i}` })),
      ...payers.map((i) => ({
        op: 'addItem',
        item: { id: hex(), name: 'X', cost: 30, payerId: people[i], participantIds: people },
      })),
    );
    expect(res.status).toBe(200);
    expect(await listed(owner, id)).toMatchObject(expected);
  });

  it('finds items by name in your own splits only', async () => {
    const owner = person('owner');
    const outsider = person('outsider');
    const { id } = await splitWith(owner);
    const p = hex();
    await change(
      owner,
      id,
      { op: 'addPerson', id: p, name: 'Ann' },
      {
        op: 'addItem',
        item: { id: hex(), name: 'Ichiran Ramen', cost: 30, payerId: p, participantIds: [p] },
      },
      {
        op: 'addItem',
        item: { id: hex(), name: '100% juice', cost: 5, payerId: p, participantIds: [p] },
      },
    );
    const search = async (who: string, q: string) =>
      (await api.call(who, 'GET', `/api/search?q=${encodeURIComponent(q)}`)).data.items as {
        name: string;
        splitName: string;
      }[];
    expect(await search(owner, 'ramen')).toMatchObject([
      { name: 'Ichiran Ramen', splitName: 'Trip', costCents: 3000, currency: 'MYR' },
    ]);
    // % is looked for as typed, not as a wildcard
    expect((await search(owner, '0%')).map((i) => i.name)).toEqual(['100% juice']);
    expect(await search(owner, '%a')).toEqual([]);
    expect(await search(outsider, 'ramen')).toEqual([]);
    expect((await api.call(owner, 'GET', '/api/search?q=r')).status).toBe(400);
  });
});

describe('item names and dates', () => {
  it('remembers item names across your splits, newest first, once each', async () => {
    const owner = person('owner');
    const outsider = person('outsider');
    const a = (await splitWith(owner)).id;
    const b = (await splitWith(owner)).id;
    const p = hex();
    const q = hex();
    await change(owner, a, { op: 'addPerson', id: p, name: 'P' });
    await change(owner, b, { op: 'addPerson', id: q, name: 'Q' });
    const add = (split: string, payer: string, name: string, category: string | null) =>
      change(owner, split, {
        op: 'addItem',
        item: { id: hex(), name, cost: 1, payerId: payer, participantIds: [payer], category },
      });
    await add(a, p, 'abc', 'Food');
    await add(b, q, 'Taxi', 'Transport');
    await add(b, q, 'ABC', null);

    const { names } = (await api.call(owner, 'GET', '/api/item-names')).data;
    expect(names.map((n: { name: string }) => n.name)).toEqual(['ABC', 'Taxi']);
    expect(names[0]).toMatchObject({ uses: 2 });
    // Only names from your own splits
    expect((await api.call(outsider, 'GET', '/api/item-names')).data.names).toEqual([]);
  });

  it('keeps a past date a new item brings, but never a future one', async () => {
    const owner = person('owner');
    const { id } = await splitWith(owner);
    const p = hex();
    await change(owner, id, { op: 'addPerson', id: p, name: 'P' });
    const lastWeek = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const item = (createdAt: number) => ({
      id: hex(),
      name: 'Dup',
      cost: 1,
      payerId: p,
      participantIds: [p],
      createdAt,
    });
    await change(owner, id, { op: 'addItem', item: item(lastWeek) });
    await change(owner, id, { op: 'addItem', item: item(Date.now() + 1e9) });
    const items = (await api.call(owner, 'GET', `/api/splits/${id}`)).data.items as {
      createdAt: number;
    }[];
    expect(items[0].createdAt).toBe(lastWeek);
    expect(items[1].createdAt).toBeLessThanOrEqual(Date.now());
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
    // The same writes from the app's own page go through, whichever header says so
    const created = await api.call(
      owner,
      'POST',
      '/api/splits',
      { id: hex(), name: 'X', currency: 'MYR' },
      { Origin: api.base },
    );
    expect(created.status).toBe(201);
    const sameOrigin = { 'Sec-Fetch-Site': 'same-origin' };
    const joined = await api.call(person('y'), 'POST', `/api/join/${token}`, undefined, sameOrigin);
    expect(joined.status).toBe(200);
    expect(joined.data.status).toBe('invited');
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
    // Archiving is a write that stays the same size, unlike a bill that grows each time.
    let accepted = 0;
    let refused = false;
    for (let i = 0; i < 130 && !refused; i++) {
      const { status } = await api.call(owner, 'PUT', '/api/archived', {
        id,
        archived: i % 2 === 0,
      });
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

  it('creates a split only with the id and currency the app sends', async () => {
    const owner = person('owner');
    const create = (body: object) => api.call(owner, 'POST', '/api/splits', body);
    expect((await create({ name: 'Trip', currency: 'MYR' })).status).toBe(400);
    expect((await create({ id: 'not-hex', name: 'Trip', currency: 'MYR' })).status).toBe(400);
    expect((await create({ id: hex(), name: 'Trip' })).status).toBe(400);
    const id = hex();
    expect((await create({ id, name: 'Trip', currency: 'MYR' })).data).toEqual({ id });
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
  it('saves the profile, settings and payment methods', async () => {
    const me = person('me');
    expect(
      (await api.call(me, 'PATCH', '/api/me', { displayName: 'Mei', settings: { theme: 'light' } }))
        .status,
    ).toBe(200);
    const methods = [
      { id: hex(), type: 'DuitNow', detail: '012-345' },
      { id: hex(), type: 'Touch n Go', detail: '019-876' },
    ];
    // The second is preferred: it's kept as picked, not the first in the list
    const put = await api.call(me, 'PUT', '/api/me/payment-methods', {
      methods,
      preferredId: methods[1].id,
    });
    expect(put.status).toBe(200);
    const profile = (await api.call(me, 'GET', '/api/me')).data;
    expect(profile.displayName).toBe('Mei');
    expect(profile.settings.theme).toBe('light');
    expect(profile.preferredPaymentMethodId).toBe(methods[1].id);
    expect(profile.paymentMethods.map((m: { id: string }) => m.id)).toEqual(
      methods.map((m) => m.id),
    );
    // People in a split with you see the preferred one first
    const friend = person('friend');
    const { id } = await splitWith(me, friend);
    const members = (await api.call(friend, 'GET', `/api/splits/${id}`)).data.members;
    const mine = members.find((m: { email: string }) => m.email === me).paymentMethods;
    expect(mine.map((m: { id: string }) => m.id)).toEqual([methods[1].id, methods[0].id]);
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
        qrVersion: null,
      },
      { id: cash, type: 'Cash', detail: '', bank: null, accountName: null, qrVersion: null },
      {
        id: wallet,
        type: 'DuitNow',
        detail: '012-345',
        bank: null,
        accountName: null,
        qrVersion: null,
      },
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
    // What the bytes are counts, not what they're labelled
    const disguised = await api.call(me, 'PUT', '/api/me/avatar', new Uint8Array(68).fill(7), {
      'Content-Type': 'image/jpeg',
    });
    expect(disguised.status).toBe(415);
    expect(disguised.data.error).toBe('Only JPEG, PNG and WebP photos are supported');
  });

  it('keeps QR code payment methods, shown only to people who share a split', async () => {
    const me = person('me');
    const friend = person('friend');
    const other = person('other');
    const id = hex();
    const qr = { id, type: 'QR code', detail: 'DuitNow QR' };
    const save = (who: string, methods: unknown[]) =>
      api.call(who, 'PUT', '/api/me/payment-methods', { methods, preferredId: id });

    // The image comes first; a QR code method without one is refused
    expect((await save(me, [qr])).status).toBe(400);
    const uploaded = await upload(me, 'PUT', `/api/me/payment-qr/${id}`);
    expect(uploaded.status).toBe(200);
    // Checked before comparing, as two missing versions would be equal too
    expect(uploaded.data.qrVersion).toEqual(expect.any(Number));
    const saved = await save(me, [qr]);
    expect(saved.status).toBe(200);
    expect(saved.data.paymentMethods[0].qrVersion).toBe(uploaded.data.qrVersion);

    // Someone else can't put their code on your method
    expect((await upload(other, 'PUT', `/api/me/payment-qr/${id}`)).status).toBe(404);

    const path = `/api/payment-qr/${id}`;
    expect((await api.call(me, 'GET', path)).status).toBe(200);
    expect((await api.call(friend, 'GET', path)).status).toBe(404);
    const { id: splitId } = await splitWith(me, friend);
    expect((await api.call(friend, 'GET', path)).status).toBe(200);
    const members = (await api.call(friend, 'GET', `/api/splits/${splitId}`)).data.members;
    const mine = members.find((m: { email: string }) => m.email === me).paymentMethods;
    expect(mine[0]).toMatchObject({ type: 'QR code', detail: 'DuitNow QR' });
    expect(mine[0].qrVersion).toBe(uploaded.data.qrVersion);

    // Removing the method removes its code
    expect((await save(me, [])).status).toBe(200);
    expect((await api.call(me, 'GET', path)).status).toBe(404);
  });

  it('lets members add photos and see the split picture, and only the owner change it', async () => {
    const owner = person('owner');
    const editor = person('editor');
    const stranger = person('stranger');
    const { id } = await splitWith(owner, editor);

    const added = await upload(editor, 'POST', `/api/splits/${id}/attachments`);
    expect(added.status).toBe(201);
    // Others in the split get back exactly the bytes that were sent
    const photo = await api.raw(owner, 'GET', `/api/splits/${id}/attachments/${added.data.id}`);
    expect(photo.status).toBe(200);
    expect(photo.headers.get('Content-Type')).toBe('image/jpeg');
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(jpeg);
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

  it('adds a photo sent again with the same id only once, and keeps that id to its sender', async () => {
    const owner = person('owner');
    const editor = person('editor');
    const { id } = await splitWith(owner, editor);
    const { id: other } = await splitWith(owner, editor);
    const photoId = hex();
    const path = `/api/splits/${id}/attachments?id=${photoId}`;

    // Sent twice at once (a retry while the first is still going): saved once
    const both = await Promise.all([upload(editor, 'POST', path), upload(editor, 'POST', path)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 201]);
    const [first] = both;
    expect(first.data.id).toBe(photoId);
    expect(both[1].data).toEqual(first.data);
    // Its answer was lost, so it's sent again later: the same photo comes back
    const again = await upload(editor, 'POST', path);
    expect(again.status).toBe(200);
    expect(again.data).toEqual(first.data);
    expect((await api.call(owner, 'GET', `/api/splits/${id}`)).data.attachments).toEqual([
      first.data,
    ]);

    // Someone else, another split, or a receipt can't take that id
    expect((await upload(owner, 'POST', path)).status).toBe(409);
    expect(
      (await upload(editor, 'POST', `/api/splits/${other}/attachments?id=${photoId}`)).status,
    ).toBe(409);
    const [p, itemId] = [hex(), hex()];
    await change(
      owner,
      id,
      { op: 'addPerson', id: p, name: 'P' },
      { op: 'addItem', item: { id: itemId, name: 'X', cost: 1, payerId: p, participantIds: [p] } },
    );
    expect((await upload(editor, 'POST', `${path}&itemId=${itemId}`)).status).toBe(409);
    expect((await api.call(owner, 'GET', `/api/splits/${id}`)).data.attachments).toHaveLength(1);

    // Ids are what the app makes
    expect(
      (await upload(editor, 'POST', `/api/splits/${id}/attachments?id=not-an-id`)).status,
    ).toBe(400);
  });

  it('lists each photo with its file type and size, and removes several at once', async () => {
    const owner = person('owner');
    const editor = person('editor');
    const { id } = await splitWith(owner, editor);
    const ownerPhoto = (await upload(owner, 'POST', `/api/splits/${id}/attachments`)).data;
    const editorPhotos = [
      (await upload(editor, 'POST', `/api/splits/${id}/attachments`)).data,
      (await upload(editor, 'POST', `/api/splits/${id}/attachments`)).data,
    ];
    expect(ownerPhoto).toMatchObject({
      contentType: 'image/jpeg',
      size: jpeg.length,
      uploadedBy: owner,
    });
    const listed = (await api.call(editor, 'GET', `/api/splits/${id}`)).data.attachments;
    expect(listed).toContainEqual(ownerPhoto);

    const remove = (who: string, ids: unknown) =>
      api.call(who, 'POST', `/api/splits/${id}/attachments/remove`, { ids });
    const ids = (await api.call(owner, 'GET', `/api/splits/${id}`)).data.attachments.map(
      (a: { id: string }) => a.id,
    );

    // One of them isn't the editor's: none are removed
    const refused = await remove(editor, [editorPhotos[0].id, ownerPhoto.id]);
    expect(refused.status).toBe(403);
    expect(refused.data.error).toBe(
      'Only the person who added a photo, or the owner, can remove it',
    );
    expect((await api.call(owner, 'GET', `/api/splits/${id}`)).data.attachments).toHaveLength(3);

    expect((await remove(editor, [])).status).toBe(400);
    expect((await remove(editor, 'nope')).status).toBe(400);
    expect(
      (
        await remove(
          editor,
          Array.from({ length: 101 }, () => ids[0]),
        )
      ).status,
    ).toBe(400);

    // Their own, and one that isn't there (already removed), are fine
    expect(
      (await remove(editor, [editorPhotos[0].id, editorPhotos[1].id, '0123456789abcdef'])).status,
    ).toBe(200);
    expect(
      (await api.call(owner, 'GET', `/api/splits/${id}`)).data.attachments.map(
        (a: { id: string }) => a.id,
      ),
    ).toEqual([ownerPhoto.id]);
    expect(
      (await api.call(owner, 'GET', `/api/splits/${id}/attachments/${editorPhotos[0].id}`)).status,
    ).toBe(404);

    // The owner removes anyone's
    expect((await remove(owner, [ownerPhoto.id])).status).toBe(200);
    expect((await api.call(owner, 'GET', `/api/splits/${id}`)).data.attachments).toEqual([]);
  });

  it('answers unknown API paths with a JSON 404', async () => {
    const res = await api.call(person('x'), 'GET', '/api/nope');
    expect(res.status).toBe(404);
    expect(res.data.error).toBe('Not found');
  });
});

describe('exchange rates', () => {
  // The Worker keeps the rates it fetches for hours, for every test after: these tests
  // look at which service a rate came from, so each uses currencies of its own
  it('converts with Wise, falls back to Frankfurter, and says when neither has a rate', async () => {
    const me = person('me');
    const [first, second] = [api.rates.newCurrency(), api.rates.newCurrency()];
    api.rates.set(first, 'MYR', 4.2);
    const res = await api.call(
      me,
      'GET',
      `/api/rates?from=${first.toLowerCase()}&to=MYR&amount=10.5`,
    );
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ from: first, to: 'MYR', rate: 4.2, source: 'wise' });
    expect(res.data.convertedCents).toBe(4410);

    api.rates.set(second, 'MYR', 3.3);
    api.rates.down('wise', true);
    const fallback = await api.call(me, 'GET', `/api/rates?from=${second}&to=MYR`);
    api.rates.down('wise', false);
    expect(fallback.data).toMatchObject({ rate: 3.3, source: 'frankfurter' });

    expect((await api.call(me, 'GET', '/api/rates?from=XXX&to=MYR')).status).toBe(503);
  });

  it("lists the other currencies in your splits with today's rate, for Settings", async () => {
    const me = person('me');
    const stranger = person('stranger');
    // Standing in for Singapore dollars and yen
    const [sgd, jpy] = [api.rates.newCurrency(), api.rates.newCurrency()];
    api.rates.set(jpy, 'MYR', 0.03);
    api.rates.set(sgd, 'MYR', 3.4);
    api.rates.set(sgd, jpy, 113);
    await api.call(me, 'POST', '/api/splits', { id: hex(), name: 'Home', currency: 'MYR' });
    const { data: tokyo } = await api.call(me, 'POST', '/api/splits', {
      id: hex(),
      name: 'Tokyo',
      currency: jpy,
    });
    // An item in Singapore dollars in the MYR split... and one in the yen split
    const { data: home } = await api.call(me, 'GET', '/api/splits');
    const homeId = home.splits.find((s: { name: string }) => s.name === 'Home').id;
    for (const id of [homeId, tokyo.id]) {
      const p = hex();
      const added = await change(
        me,
        id,
        { op: 'addPerson', id: p, name: 'Me' },
        {
          op: 'addItem',
          item: {
            id: hex(),
            name: 'Dinner',
            cost: 10,
            payerId: p,
            participantIds: [p],
            original: { currency: sgd, amount: 10 },
          },
        },
      );
      expect(added.status).toBe(200);
    }
    const res = await api.call(me, 'GET', '/api/me/rates?to=MYR');
    expect(res.status).toBe(200);
    // Most-used first, each with its rate into MYR; MYR itself isn't listed
    expect(
      res.data.currencies.map(
        (c: { currency: string; splits: number; rate: number; source: string }) => [
          c.currency,
          c.splits,
          c.rate,
          c.source,
        ],
      ),
    ).toEqual([
      [sgd, 2, 3.4, 'wise'],
      [jpy, 1, 0.03, 'wise'],
    ]);
    // Only your own splits count
    expect((await api.call(stranger, 'GET', '/api/me/rates?to=MYR')).data.currencies).toEqual([]);
  });

  it('uses the rate source each person picked in Settings', async () => {
    const wiseFan = person('wisefan');
    const ecbFan = person('ecbfan');
    const nzd = api.rates.newCurrency();
    // The two services differ, so each answer shows where it came from
    api.rates.set(nzd, 'MYR', 2.75, 'wise');
    api.rates.set(nzd, 'MYR', 2.7, 'frankfurter');
    const patch = await api.call(ecbFan, 'PATCH', '/api/me', {
      settings: { ratePreference: 'ecb', defaultCurrency: 'SGD' },
    });
    expect(patch.data.settings).toMatchObject({ ratePreference: 'ecb', defaultCurrency: 'SGD' });
    expect((await api.call(ecbFan, 'GET', `/api/rates?from=${nzd}&to=MYR`)).data).toMatchObject({
      rate: 2.7,
      source: 'frankfurter',
    });
    expect((await api.call(wiseFan, 'GET', `/api/rates?from=${nzd}&to=MYR`)).data).toMatchObject({
      rate: 2.75,
      source: 'wise',
    });
    expect(
      (await api.call(ecbFan, 'PATCH', '/api/me', { settings: { ratePreference: 'xe' } })).status,
    ).toBe(400);
    // Back to "last used"
    const reset = await api.call(ecbFan, 'PATCH', '/api/me', {
      settings: { defaultCurrency: null },
    });
    expect(reset.data.settings.defaultCurrency).toBeNull();
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

  it('keeps the rate an item was recorded with through edits, a new amount included, and converts again only for a new currency', async () => {
    const { owner, id, item, items } = await myrSplit();
    // Standing in for won and Taiwan dollars. Wise and the ECB disagree on the won, so
    // once the owner picks the ECB, today's rate is not the one the item was saved at.
    const [krw, twd] = [api.rates.newCurrency(), api.rates.newCurrency()];
    api.rates.set(krw, 'MYR', 0.0034, 'wise');
    api.rates.set(krw, 'MYR', 0.005, 'frankfurter');
    api.rates.set(twd, 'MYR', 0.14, 'frankfurter');
    const bbq = item({ name: 'BBQ', original: { currency: krw, amount: 50000 } });
    expect((await change(owner, id, { op: 'addItem', item: bbq })).status).toBe(200);
    expect((await items())[0]).toMatchObject({
      cost: 170,
      original: { rate: 0.0034, rateSource: 'wise' },
    });
    const ecb = await api.call(owner, 'PATCH', '/api/me', { settings: { ratePreference: 'ecb' } });
    expect(ecb.status).toBe(200);

    // Renaming leaves the amount alone: the saved rate stays
    const renamed = { ...bbq, name: 'Korean BBQ' };
    expect((await change(owner, id, { op: 'updateItem', item: renamed })).status).toBe(200);
    expect((await items())[0]).toMatchObject({
      name: 'Korean BBQ',
      cost: 170,
      original: { amount: 50000, rate: 0.0034, rateSource: 'wise' },
    });

    // A new amount is converted at the rate it was recorded with, not today's
    const more = { ...renamed, original: { currency: krw, amount: 60000 } };
    expect((await change(owner, id, { op: 'updateItem', item: more })).status).toBe(200);
    expect((await items())[0]).toMatchObject({
      cost: 204,
      original: { currency: krw, amount: 60000, rate: 0.0034, rateSource: 'wise' },
    });

    // A new currency needs a new rate
    const moved = { ...renamed, original: { currency: twd, amount: 60000 } };
    expect((await change(owner, id, { op: 'updateItem', item: moved })).status).toBe(200);
    expect((await items())[0]).toMatchObject({
      cost: 8400,
      original: { currency: twd, amount: 60000, rate: 0.14, rateSource: 'frankfurter' },
    });
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

  it('refuses an amount too large to hold exactly once converted, or a rate making one', async () => {
    const { owner, id, item, items } = await myrSplit();
    // The largest amount at the largest rate: past what a number holds to the cent
    const huge = item({
      original: { currency: 'THB', amount: 999999999.99, rate: 1000000, rateSource: 'manual' },
    });
    const refused = await change(owner, id, { op: 'addItem', item: huge });
    expect(refused.status).toBe(409);
    expect(refused.data.error).toBe('That comes to more than 50,000,000,000 MYR');
    expect(await items()).toEqual([]);

    // Right at the limit it saves; a typed rate taking it over is refused, changing nothing
    const big = item({
      original: { currency: 'THB', amount: 50_000_000, rate: 1000, rateSource: 'manual' },
    });
    expect((await change(owner, id, { op: 'addItem', item: big })).status).toBe(200);
    expect((await items())[0].cost).toBe(50_000_000_000);
    const over = await change(owner, id, { op: 'setRate', currency: 'THB', rate: 1001 });
    expect(over.status).toBe(409);
    expect((await items())[0]).toMatchObject({ cost: 50_000_000_000, original: { rate: 1000 } });
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
    // 3.33 and 6.67 HKD are 11.0889 and 22.2111 MYR: each rounds down, and the cent left
    // over goes to the larger remainder, A's
    expect(saved.exact).toEqual({ [a]: 11.09, [b]: 22.21 });
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

    // A refresh from an older app does nothing; going back to fetched rates replaces them
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

describe('the rate on the day an item was paid', () => {
  const DAY = 864e5;
  /** Noon UTC some days ago, and its day as the rate services name it */
  const daysAgo = (days: number) => {
    const at = Date.parse(`${rateDay(Date.now() - days * DAY)}T12:00:00Z`);
    return { at, day: rateDay(at) };
  };

  /** A MYR split with A in it, and an item paid in `currency` at `at` (now, by default) */
  async function paidIn(currency: string, amount: number, at?: number) {
    const owner = person('owner');
    const { id } = await splitWith(owner);
    const [a, itemId] = [hex(), hex()];
    const added = await change(
      owner,
      id,
      { op: 'addPerson', id: a, name: 'A' },
      {
        op: 'addItem',
        item: {
          id: itemId,
          name: 'Dinner',
          cost: 0,
          payerId: a,
          participantIds: [a],
          original: { currency, amount },
          ...(at != null && { createdAt: at }),
        },
      },
    );
    const read = async () => (await api.call(owner, 'GET', `/api/splits/${id}`)).data.items[0];
    return { owner, id, a, itemId, added, read };
  }

  it("converts an item paid on an earlier day at the ECB's rate for that day", async () => {
    const cur = api.rates.newCurrency();
    const { at, day } = daysAgo(3);
    api.rates.set(cur, 'MYR', 4);
    api.rates.setOn(day, cur, 'MYR', 3);
    const { added, read } = await paidIn(cur, 10, at);
    expect(added.status).toBe(200);
    expect(await read()).toMatchObject({
      cost: 30,
      original: { rate: 3, rateSource: 'frankfurter', rateAt: at },
    });
  });

  it('an item keeps the rate it was recorded with when moved to another day or given a new amount', async () => {
    const cur = api.rates.newCurrency();
    const week = daysAgo(7);
    api.rates.set(cur, 'MYR', 4);
    api.rates.setOn(week.day, cur, 'MYR', 3.5);
    const { owner, id, a, itemId, read } = await paidIn(cur, 10);
    expect(await read()).toMatchObject({ cost: 40, original: { rate: 4, rateSource: 'wise' } });

    await change(owner, id, { op: 'setItemDate', id: itemId, createdAt: week.at });
    expect(await read()).toMatchObject({ cost: 40, createdAt: week.at, original: { rate: 4 } });
    const dinner = { id: itemId, name: 'Dinner', cost: 0, payerId: a, participantIds: [a] };
    await change(owner, id, {
      op: 'updateItem',
      item: { ...dinner, original: { currency: cur, amount: 20 } },
    });
    expect(await read()).toMatchObject({ cost: 80, original: { rate: 4 } });

    // A typed rate stays through a move; going back to fetched rates takes its day's
    await change(owner, id, { op: 'setRate', currency: cur, rate: 5 });
    await change(owner, id, { op: 'setItemDate', id: itemId, createdAt: daysAgo(2).at });
    expect(await read()).toMatchObject({ cost: 100, original: { rate: 5, rateSource: 'manual' } });
    await change(owner, id, { op: 'setItemDate', id: itemId, createdAt: week.at });
    await change(owner, id, { op: 'setRate', currency: cur, rate: null });
    expect(await read()).toMatchObject({ cost: 70, original: { rate: 3.5 } });
  });

  it('an item added offline, moved, then put in another currency, in one batch, takes the day it was moved to', async () => {
    const [cur, other] = [api.rates.newCurrency(), api.rates.newCurrency()];
    const week = daysAgo(7);
    api.rates.set(cur, 'MYR', 4);
    api.rates.setOn(week.day, other, 'MYR', 0.5);
    const owner = person('owner');
    const { id } = await splitWith(owner);
    const [a, itemId] = [hex(), hex()];
    const dinner = { id: itemId, name: 'Dinner', cost: 0, payerId: a, participantIds: [a] };
    const saved = await change(
      owner,
      id,
      { op: 'addPerson', id: a, name: 'A' },
      { op: 'addItem', item: { ...dinner, original: { currency: cur, amount: 10 } } },
      { op: 'setItemDate', id: itemId, createdAt: week.at },
      { op: 'updateItem', item: { ...dinner, original: { currency: other, amount: 100 } } },
    );
    expect(saved.status).toBe(200);
    const item = (await api.call(owner, 'GET', `/api/splits/${id}`)).data.items[0];
    expect(item).toMatchObject({ cost: 50, createdAt: week.at, original: { rate: 0.5 } });
  });

  it("an edit in another currency converts at the item's own day, not today", async () => {
    const [old, cur] = [api.rates.newCurrency(), api.rates.newCurrency()];
    const { at, day } = daysAgo(4);
    api.rates.setOn(day, old, 'MYR', 2);
    api.rates.set(cur, 'MYR', 4);
    api.rates.setOn(day, cur, 'MYR', 3);
    const { owner, id, a, itemId, read } = await paidIn(old, 10, at);
    expect((await read()).cost).toBe(20);
    await change(owner, id, {
      op: 'updateItem',
      item: {
        id: itemId,
        name: 'Dinner',
        cost: 0,
        payerId: a,
        participantIds: [a],
        original: { currency: cur, amount: 20 },
      },
    });
    expect(await read()).toMatchObject({ cost: 60, createdAt: at, original: { rate: 3 } });
  });

  it("takes Wise's rate for the day when the ECB has none, and today's when neither has it", async () => {
    const [wiseOnly, neither] = [api.rates.newCurrency(), api.rates.newCurrency()];
    const { at, day } = daysAgo(5);
    api.rates.setOn(day, wiseOnly, 'MYR', 0.2, 'wise');
    const fromWise = await paidIn(wiseOnly, 100, at);
    expect(await fromWise.read()).toMatchObject({
      cost: 20,
      original: { rate: 0.2, rateSource: 'wise', rateAt: at },
    });

    // Wise answers with today's rate for that day: not the day's, so today's is used
    // and says so by its date
    api.rates.set(neither, 'MYR', 0.3, 'wise');
    const today = await paidIn(neither, 100, at);
    const item = await today.read();
    expect(item).toMatchObject({ cost: 30, original: { rate: 0.3, rateSource: 'wise' } });
    expect(rateDay(item.original.rateAt)).toBe(rateDay(Date.now()));
  });

  it("waits rather than settle for today's rate when a service is down", async () => {
    const cur = api.rates.newCurrency();
    const { at } = daysAgo(6);
    // Wise has only today's rate, and the ECB, which might have had the day's, is down
    api.rates.set(cur, 'MYR', 4, 'wise');
    api.rates.down('frankfurter', true);
    const { added, read } = await paidIn(cur, 10, at);
    expect(added.status).toBe(503);
    expect(await read()).toBeUndefined();
  });

  it('previews the rate for a day, and refuses a time that has not come', async () => {
    const me = person('me');
    const cur = api.rates.newCurrency();
    const { at, day } = daysAgo(3);
    api.rates.set(cur, 'MYR', 4);
    api.rates.setOn(day, cur, 'MYR', 3);
    const quote = await api.call(me, 'GET', `/api/rates?from=${cur}&to=MYR&at=${at}`);
    expect(quote.data).toMatchObject({ rate: 3, source: 'frankfurter', fetchedAt: at });
    const now = await api.call(me, 'GET', `/api/rates?from=${cur}&to=MYR&at=${Date.now()}`);
    expect(now.data).toMatchObject({ rate: 4, source: 'wise' });
    const later = Date.now() + 30 * DAY;
    expect((await api.call(me, 'GET', `/api/rates?from=${cur}&to=MYR&at=${later}`)).status).toBe(
      400,
    );
  });

  it("converts each item at its own day's rate when the split's currency changes", async () => {
    const [cur, to] = [api.rates.newCurrency(), api.rates.newCurrency()];
    const { at, day } = daysAgo(3);
    api.rates.set(cur, 'MYR', 4);
    api.rates.set(cur, to, 0.25);
    api.rates.setOn(day, cur, to, 0.2);
    api.rates.set('MYR', to, 0.21);
    api.rates.setOn(day, 'MYR', to, 0.19);
    const { owner, id, a } = await paidIn(cur, 10, at);
    await change(owner, id, {
      op: 'addItem',
      item: { id: hex(), name: 'Taxi', cost: 10, payerId: a, participantIds: [a], createdAt: at },
    });
    await api.call(owner, 'PATCH', `/api/splits/${id}`, { currency: to });
    let split = (await api.call(owner, 'GET', `/api/splits/${id}`)).data;
    for (let i = 0; split.converting && i < 40; i++) {
      await new Promise((r) => setTimeout(r, 150));
      split = (await api.call(owner, 'GET', `/api/splits/${id}`)).data;
    }
    const byName = (name: string) => split.items.find((i: { name: string }) => i.name === name);
    expect(byName('Dinner')).toMatchObject({ cost: 2, original: { rate: 0.2 } });
    expect(byName('Taxi')).toMatchObject({ cost: 1.9, original: { currency: 'MYR', rate: 0.19 } });
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

  /** Waits until `check` holds, trying every 150 ms for up to `seconds` */
  async function until(check: () => Promise<boolean> | boolean, seconds: number, what: string) {
    for (const end = Date.now() + seconds * 1000; Date.now() < end; ) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`Timed out waiting for ${what}`);
  }

  /** The split's total in My splits, which (unlike opening it) never retries a conversion */
  const listedTotal = async (who: string, id: string) => (await listed(who, id))?.totalCents;

  /** A split with one 10 MYR item paid by A, its owner, and A */
  async function splitToConvert() {
    const owner = person('owner');
    const { id } = await splitWith(owner);
    const a = hex();
    await change(owner, id, { op: 'addPerson', id: a, name: 'A' });
    await change(owner, id, {
      op: 'addItem',
      item: { id: hex(), name: 'Tea', cost: 10, payerId: a, participantIds: [a] },
    });
    return { owner, id, a };
  }

  it('finishes on its own once rates are back, without anyone opening the split', async () => {
    const { owner, id } = await splitToConvert();
    const to = api.rates.newCurrency();

    api.rates.down('wise', true);
    api.rates.down('frankfurter', true);
    const patched = await api.call(owner, 'PATCH', `/api/splits/${id}`, { currency: to });
    expect(patched.data.converting).toBe(true);
    // The first attempt failed, and so did the queue's first retry (both services, each)
    await until(() => api.rates.asked('MYR', to) >= 4, 20, 'two failed attempts');
    expect(await listedTotal(owner, id)).toBe(1000);

    api.rates.down('wise', false);
    api.rates.down('frankfurter', false);
    api.rates.set('MYR', to, 0.5);
    // Nobody opens the split: only the queue can finish it
    await until(async () => (await listedTotal(owner, id)) === 500, 30, 'the queue to convert');

    const split = (await api.call(owner, 'GET', `/api/splits/${id}`)).data;
    expect(split.converting).toBe(false);
    expect(split.items[0]).toMatchObject({ cost: 5, original: { currency: 'MYR', amount: 10 } });
  }, 60_000);

  // A retry for an older change leaving a newer one alone: reconvert.test.ts, on the real
  // converter, without waiting here for a retry that would do nothing
  it('holds item changes until converted, and finishes once rates are back', async () => {
    const { owner, id, a } = await splitToConvert();

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
