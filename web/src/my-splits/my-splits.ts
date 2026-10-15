import { api } from '../api';
import { isOfflineFailure, readPendingCreates } from '../offline/outbox';
import { queryClient } from '../query-client';
import { readCache, writeCache } from '../offline/cache';
import type { MyInvite, SplitSummary } from '../../../shared/api';
import { showError } from '../utils/notify';

// My splits and pending invites, shared by the sidebar, My splits and Invites pages so
// they load once and always agree. The last-seen copy shows while a fresh one loads.
// The screens read it through useMySplits; anything can change or reload it here.

export interface MySplits {
  splits: SplitSummary[] | null;
  invites: MyInvite[] | null;
  error: string | null;
}

type Loaded = { splits: SplitSummary[]; invites: MyInvite[] };

export const MY_SPLITS_KEY = ['home'] as const;
const CACHE_KEY = 'home-v2';

/** Adds splits made on this device that the server doesn't have yet (say, offline) */
const withCreating = async (listed: SplitSummary[]) => {
  const creating = (await readPendingCreates()).map((c) => c.summary);
  return [...creating.filter((c) => !listed.some((s) => s.id === c.id)), ...listed];
};

export const fetchMySplits = async (): Promise<Loaded> => {
  let listed: SplitSummary[], invites: MyInvite[];
  try {
    [{ splits: listed }, { invites }] = await Promise.all([api.listSplits(), api.listInvites()]);
  } catch (err) {
    if (!isOfflineFailure(err)) throw err;
    // Offline: what was saved on this device, fetched again once back online
    const saved = await readCache<Loaded>(CACHE_KEY);
    return { splits: await withCreating(saved?.splits ?? []), invites: saved?.invites ?? [] };
  }
  // Saved as the server has it; splits still being created are added when read
  void writeCache(CACHE_KEY, { splits: listed, invites });
  return { splits: await withCreating(listed), invites };
};

/**
 * Shows the copy saved on this device, unless something is showing already: a fresh copy,
 * or this one shown before
 */
export function showSavedCopy() {
  if (queryClient.getQueryData(MY_SPLITS_KEY) !== undefined) return;
  void readCache<Loaded>(CACHE_KEY).then(async (cached) => {
    if (cached == null) return;
    const splits = await withCreating(cached.splits);
    if (queryClient.getQueryState(MY_SPLITS_KEY)?.dataUpdatedAt) return;
    // Marked as old, so it's shown but still fetched
    queryClient.setQueryData(MY_SPLITS_KEY, { ...cached, splits }, { updatedAt: 0 });
  });
}

export const toMySplits = (data: Loaded | undefined, failed: boolean): MySplits => ({
  splits: data?.splits ?? null,
  invites: data?.invites ?? null,
  error: failed && data == null ? 'Could not load your splits.' : null,
});

/** Changes what's shown straight away, before the server has confirmed it */
export function updateMySplits(change: (data: MySplits) => Partial<Loaded>) {
  queryClient.setQueryData<Loaded>(MY_SPLITS_KEY, (old) => {
    const next = change(toMySplits(old, false));
    return {
      splits: next.splits ?? old?.splits ?? [],
      invites: next.invites ?? old?.invites ?? [],
    };
  });
}

/** Adds a split to the top of My splits straight away */
export const addListedSplit = (split: SplitSummary) =>
  updateMySplits(({ splits }) => ({ splits: [split, ...(splits ?? [])] }));

/** Changes one split in My splits straight away */
export const patchListedSplit = (id: string, changes: Partial<SplitSummary>) =>
  updateMySplits(({ splits }) => ({
    splits: splits?.map((s) => (s.id === id ? { ...s, ...changes } : s)),
  }));

/** Takes a split out of My splits straight away */
export const removeListedSplit = (id: string) =>
  updateMySplits(({ splits }) => ({ splits: splits?.filter((s) => s.id !== id) }));

/** Takes an invite out of the list straight away */
export const removeListedInvite = (id: string) =>
  updateMySplits(({ invites }) => ({ invites: invites?.filter((i) => i.id !== id) }));

/**
 * Sends a change already shown in My splits. Either way the list is then fetched again,
 * so it shows what the server has: the change confirmed, or put back after a failure
 * (which is explained). Resolves with the server's answer, or undefined after a failure.
 */
export async function sendMySplitsChange<T>(
  request: () => Promise<T>,
  failure: string,
): Promise<T | undefined> {
  try {
    return await request();
  } catch (err) {
    showError(err, failure);
    return undefined;
  } finally {
    void reloadMySplits();
  }
}

/** Moves a split to where another one is, in your own order, and saves the new order */
export function moveSplit(id: string, toId: string) {
  let ids: string[] | null = null;
  updateMySplits(({ splits }) => {
    const list = [...(splits ?? [])];
    const from = list.findIndex((s) => s.id === id);
    const to = list.findIndex((s) => s.id === toId);
    if (from < 0 || to < 0) return {};
    list.splice(to, 0, ...list.splice(from, 1));
    ids = list.map((s) => s.id);
    return { splits: list };
  });
  if (ids == null) return;
  api.reorderSplits(ids).catch((err: unknown) => {
    showError(err, 'Could not save the new order');
    void reloadMySplits();
  });
}

/** Fetches the latest splits and invites; concurrent calls share one request */
export function reloadMySplits(): Promise<void> {
  return queryClient.refetchQueries({ queryKey: MY_SPLITS_KEY, type: 'all' }).then(async () => {
    // Nothing has asked for it yet: fetch it now so it's there when they do
    if (queryClient.getQueryState(MY_SPLITS_KEY) == null) {
      await queryClient.prefetchQuery({ queryKey: MY_SPLITS_KEY, queryFn: fetchMySplits });
    }
  });
}
