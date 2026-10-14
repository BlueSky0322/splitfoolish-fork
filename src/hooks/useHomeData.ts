import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { MyInvite, SplitSummary, api } from '../api';
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

const fetchHome = async (): Promise<Loaded> => {
  const [{ splits }, { invites }] = await Promise.all([api.listSplits(), api.myInvites()]);
  void writeCache(CACHE_KEY, { splits, invites });
  return { splits, invites };
};

let cacheRead = false;

/** Shows the copy saved on this device, unless a fresh one has already arrived */
function readSavedCopy() {
  if (cacheRead) return;
  cacheRead = true;
  void readCache<Loaded>(CACHE_KEY).then((cached) => {
    if (cached == null || queryClient.getQueryState(HOME_KEY)?.dataUpdatedAt) return;
    // Marked as old, so it's shown but still fetched
    queryClient.setQueryData(HOME_KEY, cached, { updatedAt: 0 });
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
