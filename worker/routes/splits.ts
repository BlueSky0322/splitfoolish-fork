// Splits: listing and creating them, and everything under one split. Routes under a
// split go through `membersOnly` (and `ownerOnly`, or `allowedIf` a rule from
// shared/rules.ts, where only the owner may act), except opening one, which checks
// membership in the same database round trip as the rest. The work is in splits.ts and
// the other feature modules.

import { Hono } from 'hono';
import type {
  ChangesBody,
  CreateSplitBody,
  Created,
  ShareTokenResult,
  ItemNames,
  RatePreference,
  SplitDetail,
  SplitList,
  SplitOrderBody,
  SplitPatch,
  UpdateSplitResult,
} from '../../shared/api';
import { isCurrency } from '../../shared/rates';
import { canEditSplitSettings, canRemoveMember } from '../../shared/rules';
import { MAX_NAME_LENGTH } from '../../shared/types';
import type { AppEnv } from '../app';
import {
  ID_PARAM,
  ID_PATTERN,
  SPLIT_PATH,
  allowedIf,
  batchGroups,
  getRole,
  membersOnly,
  ownerOnly,
} from '../app';
import {
  json,
  notFound,
  readName,
  fail,
  ok,
  isClientId,
  isConstraintError,
  isCrossSite,
  readJson,
} from '../http';
import {
  deleteAttachment,
  deleteSplitPicture,
  putSplitPicture,
  serveAttachment,
  serveSplitPicture,
  uploadAttachment,
} from '../photos';
import { getRatePreference } from '../profiles';
import { REFRESH_MAX_AGE_MS, getRate } from '../rates';
import { evictFromRoom, joinRoom } from '../room';
import {
  leaveStatement,
  removeAccessStatements,
  resetShareLinks,
  revokeInviteStatement,
} from '../sharing';
import { applyChanges } from '../split-content';
import { assembleSplitDetail, splitDetailStatements } from '../split-detail';
import {
  createSplitStatements,
  deleteSplitStatements,
  retryStalledReconvert,
  splitOrderStatements,
  splitSettingsStatements,
  startReconvert,
} from '../splits';
import { listItemNames, listSplitSummaries } from '../summaries';

const splits = new Hono<AppEnv>();

const MAX_ORDERED = 500;

const NAME_LENGTH = `Name must be 1-${MAX_NAME_LENGTH} characters`;

// Any change saved under a split tells the apps that have it open, once it succeeds
splits.use(`${SPLIT_PATH}/*`, async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') c.set('changedSplit', c.req.param('id'));
  await next();
});

splits.get('/splits', async (c) =>
  json<SplitList>({ splits: await listSplitSummaries(c.env.DB, c.var.email) }),
);

// Your own order for your splits, as dragged in the app: every id, first to last
splits.put('/splits/order', async (c) => {
  const db = c.env.DB;
  const body = await readJson<SplitOrderBody>(c.req.raw);
  if (body instanceof Response) return body;
  const ids = body.ids;
  if (
    !Array.isArray(ids) ||
    ids.length > MAX_ORDERED ||
    !ids.every((id) => typeof id === 'string' && ID_PATTERN.test(id))
  ) {
    return fail('Send the split ids in order', 400);
  }
  if (ids.length === 0) return ok();
  await db.batch(splitOrderStatements(db, c.var.email, ids as string[]));
  return ok();
});

// Names of items in your splits, for suggesting as you type one
splits.get('/item-names', async (c) =>
  json<ItemNames>({ names: await listItemNames(c.env.DB, c.var.email) }),
);

splits.post('/splits', async (c) => {
  const db = c.env.DB;
  const body = await readJson<CreateSplitBody>(c.req.raw);
  if (body instanceof Response) return body;
  const name = readName(body.name);
  if (name == null) return fail(NAME_LENGTH, 400);
  const { id, currency } = body;
  if (!isCurrency(currency)) return fail('Invalid currency', 400);
  // The app picks the id, so it can open the new split before this finishes
  if (!isClientId(id)) return fail('Invalid split id', 400);
  const created = await db.batch(createSplitStatements(db, id, name, currency, c.var.email)).then(
    () => true,
    (err) => {
      // That id is already taken
      if (isConstraintError(err)) return false;
      throw err;
    },
  );
  if (!created) return fail('That split already exists', 409);
  return json<Created>({ id }, 201);
});

splits.get(SPLIT_PATH, async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const opened = assembleSplitDetail(
    id,
    await batchGroups(db, splitDetailStatements(db, id, c.var.email)),
  );
  if (opened == null) return notFound();
  retryStalledReconvert(c.env, c.executionCtx, id, c.var.email, opened.convertingSince);
  return json<SplitDetail>(opened.detail);
});

// Live updates: a WebSocket that hears when anyone saves a change to the split. Opened
// from this site only, as the sign-in cookie rides along with it.
splits.get(`${SPLIT_PATH}/ws`, membersOnly, (c) => {
  if (isCrossSite(c.req.raw, new URL(c.req.url))) {
    return fail('Not allowed from another site', 403);
  }
  return joinRoom(c.env, c.req.param('id'), c.req.raw, c.var.email);
});

// Split settings: rename, change currency
splits.patch(
  SPLIT_PATH,
  membersOnly,
  allowedIf(canEditSplitSettings, 'Only the owner can change split settings'),
  async (c) => {
    const db = c.env.DB;
    const id = c.req.param('id');
    const body = await readJson<SplitPatch>(c.req.raw);
    if (body instanceof Response) return body;
    const changes: { name?: string; currency?: string } = {};
    if ('name' in body) {
      const name = readName(body.name);
      if (name == null) return fail(NAME_LENGTH, 400);
      changes.name = name;
    }
    if ('currency' in body) {
      if (!isCurrency(body.currency)) return fail('Invalid currency', 400);
      changes.currency = body.currency;
    }
    const { statements, converting } = await splitSettingsStatements(db, id, changes);
    if (statements.length > 0) await db.batch(statements);
    if (converting) startReconvert(c.env, c.executionCtx, id, c.var.email);
    return json<UpdateSplitResult>({ ok: true, converting });
  },
);

splits.delete(
  SPLIT_PATH,
  membersOnly,
  ownerOnly('Only the owner can delete this split'),
  async (c) => {
    await c.env.DB.batch(deleteSplitStatements(c.env.DB, c.req.param('id')));
    return ok();
  },
);

// The bill (people and items); applyChanges decides what each role may change
splits.post(`${SPLIT_PATH}/changes`, membersOnly, async (c) => {
  const body = await readJson<ChangesBody>(c.req.raw);
  if (body instanceof Response) return body;
  // Looked up only if the changes need a rate
  let prefer: Promise<RatePreference> | null = null;
  return applyChanges(c.env.DB, c.req.param('id'), { email: c.var.email, role: c.var.role }, body, {
    fetchRate: async (from, to, { fresh }) =>
      getRate(c.env, from, to, {
        prefer: await (prefer ??= getRatePreference(c.env.DB, c.var.email)),
        maxAgeMs: fresh ? REFRESH_MAX_AGE_MS : undefined,
      }),
    onAccessRemoved: (emails) => evictFromRoom(c.env, c.executionCtx, c.req.param('id'), emails),
  });
});

// The split's picture: anyone in it sees it, only the owner changes it
const changePicture = allowedIf(canEditSplitSettings, 'Only the owner can change the picture');
splits.get(`${SPLIT_PATH}/picture`, membersOnly, (c) =>
  serveSplitPicture(c.env.DB, c.req.param('id')),
);
splits.put(`${SPLIT_PATH}/picture`, membersOnly, changePicture, (c) =>
  putSplitPicture(c.env.DB, c.req.param('id'), c.req.raw),
);
splits.delete(`${SPLIT_PATH}/picture`, membersOnly, changePicture, (c) =>
  deleteSplitPicture(c.env.DB, c.req.param('id')),
);

// Photos can be added by any member, and removed by whoever added them or the owner
splits.post(`${SPLIT_PATH}/attachments`, membersOnly, (c) =>
  uploadAttachment(c.env.DB, c.req.param('id'), c.var.email, c.req.raw),
);
splits.get(`${SPLIT_PATH}/attachments/:attachmentId${ID_PARAM}`, membersOnly, (c) =>
  serveAttachment(c.env.DB, c.req.param('id'), c.req.param('attachmentId')),
);
splits.delete(`${SPLIT_PATH}/attachments/:attachmentId${ID_PARAM}`, membersOnly, (c) =>
  deleteAttachment(c.env.DB, c.req.param('id'), c.req.param('attachmentId'), {
    email: c.var.email,
    role: c.var.role,
  }),
);

// New share links, the owner's and every member's; invites picked up from the old ones go
splits.post(
  `${SPLIT_PATH}/invite`,
  membersOnly,
  ownerOnly('Only the owner can reset the invite link'),
  async (c) =>
    json<ShareTokenResult>({ shareToken: await resetShareLinks(c.env.DB, c.req.param('id')) }),
);

splits.delete(
  `${SPLIT_PATH}/invites/:inviteId${ID_PARAM}`,
  membersOnly,
  ownerOnly('Only the owner can revoke invites'),
  async (c) => {
    await revokeInviteStatement(c.env.DB, c.req.param('id'), c.req.param('inviteId')).run();
    // Already gone is fine, as for every other delete: the result is the same
    return ok();
  },
);

// Owners remove anyone but themselves; others can only remove themselves (leave)
splits.delete(`${SPLIT_PATH}/members/:email`, membersOnly, async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const email = c.var.email;
  const target = c.req.param('email').toLowerCase();

  const targetRole = await getRole(db, id, target);
  // Already gone is fine, as for every other delete: the result is the same
  if (targetRole == null) return ok();
  if (targetRole === 'owner') return fail('The owner cannot be removed', 400);
  if (!canRemoveMember(target, { email, role: c.var.role })) {
    return fail('Only the owner can remove members', 403);
  }

  // Leaving is a choice and the link still works; being removed shuts the door
  await db.batch(
    target === email ? [leaveStatement(db, id, target)] : removeAccessStatements(db, id, target),
  );
  evictFromRoom(c.env, c.executionCtx, id, [target]);
  return ok();
});

export default splits;
