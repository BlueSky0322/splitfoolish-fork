import { notifications } from '@mantine/notifications';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { MyInvite, SplitSummary, api } from '../api';
import { isNetworkError } from '../offline/outbox';
import { pendingCreates } from '../pending-creates';
import { queryClient } from '../query-client';
import { readCache, writeCache } from '../split-cache';

// My splits and pending invites, shared by the sidebar, My splits and Invites pages so
// they load once and always agree. The last-seen copy shows while a fresh one loads.

interface HomeData {
  splits: SplitSummary[] | null;
  invites: MyInvite[] | null;
  error: string | null;
}

type Loaded = { splits: SplitSummary[]; invites: MyInvite[] };

const HOME_KEY = ['home'] as const;
const CACHE_KEY = 'home-v2';

/** Adds splits made on this device that the server doesn't have yet (say, offline) */
const withCreating = async (listed: SplitSummary[]) => {
  const creating = (await pendingCreates()).map((c) => c.summary);
  return [...creating.filter((c) => !listed.some((s) => s.id === c.id)), ...listed];
};

const fetchHome = async (): Promise<Loaded> => {
  let listed: SplitSummary[], invites: MyInvite[];
  try {
    [{ splits: listed }, { invites }] = await Promise.all([api.listSplits(), api.myInvites()]);
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    // Offline: what was saved on this device, fetched again once back online
    const saved = await readCache<Loaded>(CACHE_KEY);
    return { splits: await withCreating(saved?.splits ?? []), invites: saved?.invites ?? [] };
  }
  // Saved as the server has it; splits still being created are added when read
  void writeCache(CACHE_KEY, { splits: listed, invites });
  return { splits: await withCreating(listed), invites };
};

let cacheRead = false;

/** Shows the copy saved on this device, unless a fresh one has already arrived */
function readSavedCopy() {
  if (cacheRead) return;
  cacheRead = true;
  void readCache<Loaded>(CACHE_KEY).then(async (cached) => {
    if (cached == null) return;
    const splits = await withCreating(cached.splits);
    if (queryClient.getQueryState(HOME_KEY)?.dataUpdatedAt) return;
    // Marked as old, so it's shown but still fetched
    queryClient.setQueryData(HOME_KEY, { ...cached, splits }, { updatedAt: 0 });
  });
}

const toHomeData = (data: Loaded | undefined, failed: boolean): HomeData => ({
  splits: data?.splits ?? null,
  invites: data?.invites ?? null,
  error: failed && data == null ? 'Could not load your splits.' : null,
});

/** Changes what's shown straight away, before the server has confirmed it */
export function updateHomeData(change: (data: HomeData) => Partial<HomeData>) {
  queryClient.setQueryData<Loaded>(HOME_KEY, (old) => {
    const next = change(toHomeData(old, false));
    return {
      splits: next.splits ?? old?.splits ?? [],
      invites: next.invites ?? old?.invites ?? [],
    };
  });
}

/** Moves a split to where another one is, in your own order, and saves the new order */
export function moveSplit(id: string, toId: string) {
  let ids: string[] | null = null;
  updateHomeData(({ splits }) => {
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
    notifications.show({
      color: 'red',
      message: err instanceof Error ? err.message : 'Could not save the new order',
    });
    void reloadHomeData();
  });
}

/** Fetches the latest splits and invites; concurrent calls share one request */
export function reloadHomeData(): Promise<void> {
  return queryClient.refetchQueries({ queryKey: HOME_KEY, type: 'all' }).then(async () => {
    // Nothing has asked for it yet: fetch it now so it's there when they do
    if (queryClient.getQueryState(HOME_KEY) == null) {
      await queryClient.prefetchQuery({ queryKey: HOME_KEY, queryFn: fetchHome });
    }
  });
}

/** The same data without asking for a fresh copy, for screens that only read it */
export function useHomeDataSnapshot(): HomeData {
  const { data, isError } = useQuery({ queryKey: HOME_KEY, queryFn: fetchHome, enabled: false });
  return toHomeData(data, isError);
}

export function useHomeData(): HomeData {
  useEffect(readSavedCopy, []);
  const { data, isError } = useQuery({ queryKey: HOME_KEY, queryFn: fetchHome });
  return toHomeData(data, isError);
}
