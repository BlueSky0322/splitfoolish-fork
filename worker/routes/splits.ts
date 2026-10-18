// Splits: listing and creating them, and everything under one split. Routes under a
// split go through `membersOnly` (and `allowedIf` a rule from
// shared/rules.ts, where only the owner may act), except opening one, which checks
// membership in the same database round trip as the rest. The work is in the feature
// folders: splits/, bill/, currency/ and photos/.

import { Hono } from 'hono';
import type {
  ArchiveBody,
  ChangesBody,
  CreateSplitBody,
  Created,
  ShareTokenResult,
  ItemNames,
  RatePreference,
  SearchResult,
  SplitDetail,
  SplitList,
  SplitOrderBody,
  SplitPatch,
  UpdateSplitResult,
  RemovePhotosBody,
} from '../../shared/api';
import { MAX_PHOTOS_REMOVED } from '../../shared/api';
import { isCurrency } from '../../shared/rates';
import {
  canDeleteSplit,
  canEditSplitSettings,
  canManageInvites,
  canRemoveMember,
} from '../../shared/rules';
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
} from '../app';
import {
  json,
  notFound,
  readName,
  fail,
  ok,
  isConstraintError,
  isCrossSite,
  readJson,
} from '../http';
import { deleteAttachments, serveAttachment, uploadAttachment } from '../photos/attachments';
import { deleteSplitPicture, putSplitPicture, serveSplitPicture } from '../photos/pictures';
import { getRatePreference } from '../accounts/profiles';
import { getRateOn } from '../currency/exchange-rates';
import { evictFromRoom, joinRoom } from '../splits/room';
import {
  leaveStatement,
  revokeMemberStatements,
  resetShareLinks,
  revokeInviteStatement,
} from '../splits/sharing';
import { applyChanges } from '../bill/changes';
import { assembleSplitDetail, splitDetailStatements } from '../splits/detail';
import {
  createSplitStatements,
  deleteSplitStatements,
  retryStalledReconvert,
  splitOrderStatements,
  planSplitSettings,
  startReconvert,
} from '../splits/lifecycle';
import { listItemNames, listSplitSummaries, searchItems } from '../splits/summaries';
import { isRowId } from '../../shared/api';

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

// Archiving a split takes it out of your Active list; only your own row changes
splits.put('/archived', async (c) => {
  const body = await readJson<ArchiveBody>(c.req.raw);
  if (body instanceof Response) return body;
  if (
    typeof body.id !== 'string' ||
    !ID_PATTERN.test(body.id) ||
    typeof body.archived !== 'boolean'
  ) {
    return fail('Send the split id and whether it is archived', 400);
  }
  const { meta } = await c.env.DB.prepare(
    'UPDATE split_members SET archived_at = ? WHERE split_id = ? AND email = ?',
  )
    .bind(body.archived ? Date.now() : null, body.id, c.var.email)
    .run();
  return meta.changes === 0 ? notFound() : ok();
});

/** Searches need at least this much to go on, and at most this much */
const SEARCH_LENGTH = { min: 2, max: 100 };

// Items in your splits by name
splits.get('/search', async (c) => {
  const text = (c.req.query('q') ?? '').trim();
  if (text.length < SEARCH_LENGTH.min || text.length > SEARCH_LENGTH.max) {
    return fail(`Search for ${SEARCH_LENGTH.min}-${SEARCH_LENGTH.max} characters`, 400);
  }
  return json<SearchResult>({ items: await searchItems(c.env.DB, c.var.email, text) });
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
  if (!isRowId(id)) return fail('Invalid split id', 400);
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
    const { statements, converting, since } = await planSplitSettings(db, id, changes);
    if (statements.length > 0) await db.batch(statements);
    if (converting) startReconvert(c.env, c.executionCtx, id, c.var.email, since);
    return json<UpdateSplitResult>({ ok: true, converting });
  },
);

splits.delete(
  SPLIT_PATH,
  membersOnly,
  allowedIf(canDeleteSplit, 'Only the owner can delete this split'),
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
    fetchRate: async (from, to, at) =>
      getRateOn(c.env, from, to, at, {
        prefer: await (prefer ??= getRatePreference(c.env.DB, c.var.email)),
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
  deleteAttachments(c.env.DB, c.req.param('id'), [c.req.param('attachmentId')], {
    email: c.var.email,
    role: c.var.role,
  }),
);
// Several at once, chosen on the Photos tab
splits.post(`${SPLIT_PATH}/attachments/remove`, membersOnly, async (c) => {
  const body = await readJson<RemovePhotosBody>(c.req.raw);
  if (body instanceof Response) return body;
  const { ids } = body;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > MAX_PHOTOS_REMOVED ||
    !ids.every((id) => typeof id === 'string' && ID_PATTERN.test(id))
  ) {
    return fail(`Send 1-${MAX_PHOTOS_REMOVED} photo ids`, 400);
  }
  return deleteAttachments(c.env.DB, c.req.param('id'), ids as string[], {
    email: c.var.email,
    role: c.var.role,
  });
});

// New share links, the owner's and every member's; invites picked up from the old ones go
splits.post(
  `${SPLIT_PATH}/invite`,
  membersOnly,
  allowedIf(canManageInvites, 'Only the owner can reset the invite link'),
  async (c) =>
    json<ShareTokenResult>({ shareToken: await resetShareLinks(c.env.DB, c.req.param('id')) }),
);

splits.delete(
  `${SPLIT_PATH}/invites/:inviteId${ID_PARAM}`,
  membersOnly,
  allowedIf(canManageInvites, 'Only the owner can revoke invites'),
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
    target === email ? [leaveStatement(db, id, target)] : revokeMemberStatements(db, id, target),
  );
  evictFromRoom(c.env, c.executionCtx, id, [target]);
  return ok();
});

export default splits;
