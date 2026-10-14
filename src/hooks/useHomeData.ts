import { useEffect, useSyncExternalStore } from 'react';
import { MyInvite, SplitSummary, api } from '../api';
import { readCache, writeCache } from '../split-cache';

// My splits and pending invites, shared by the sidebar, My splits and Invites pages so
// they load once and always agree. The last-seen copy shows while a fresh one loads.

interface HomeData {
  splits: SplitSummary[] | null;
  invites: MyInvite[] | null;
  error: string | null;
}

let state: HomeData = { splits: null, invites: null, error: null };
const listeners = new Set<() => void>();
let freshLoaded = false;
let cacheRead = false;
let inFlight: Promise<void> | null = null;

function setState(next: Partial<HomeData>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

/** Changes what's shown straight away, before the server has confirmed it */
export function updateHomeData(change: (data: HomeData) => Partial<HomeData>) {
  setState(change(state));
}

/** Fetches the latest splits and invites; concurrent calls share one request */
export function reloadHomeData(): Promise<void> {
  inFlight ??= Promise.all([api.listSplits(), api.myInvites()])
    .then(([{ splits }, { invites }]) => {
      freshLoaded = true;
      setState({ splits, invites, error: null });
      void writeCache('home-v2', { splits, invites });
    })
    .catch(() => setState({ error: 'Could not load your splits.' }))
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The same data without asking for a fresh copy, for screens that only read it */
export const useHomeDataSnapshot = () => useSyncExternalStore(subscribe, () => state);

export function useHomeData() {
  const data = useSyncExternalStore(subscribe, () => state);

  useEffect(() => {
    if (!cacheRead) {
      cacheRead = true;
      void readCache<{ splits: SplitSummary[]; invites: MyInvite[] }>('home-v2').then((cached) => {
        if (cached == null || freshLoaded) return;
        setState({ splits: cached.splits, invites: cached.invites });
      });
    }
    void reloadHomeData();
  }, []);

  return data;
}
