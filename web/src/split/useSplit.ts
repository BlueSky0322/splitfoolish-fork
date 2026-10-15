import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ApiError, NetworkError, api } from '../api';
import type { SplitState } from './state';
import { toApiItem, type MetaChanges, type SplitMeta, type SyncStatus } from './state';
import { readCache, removeCacheEntry, splitCacheKey, writeCache } from '../offline/cache';
import { whenCreated } from '../offline/pending-creates';
import { isOfflineFailure, isOffline } from '../offline/outbox';
import { useSaveQueue } from './useSaveQueue';
import { useSplitLive } from './useSplitLive';
import type { SplitDetail } from '../../../shared/api';
import { patchListedSplit, reloadMySplits } from '../my-splits/my-splits';
import { showError } from '../utils/notify';
import type { SplitActions } from './actions';
import { makeSplitActions } from './actions';
import { useSplitState } from './SplitStateContext';

/** Provided by the split page */
export const SplitActionsContext = createContext<SplitActions | null>(null);

export function useSplitActions(): SplitActions {
  const value = useContext(SplitActionsContext);
  if (value == null) throw new Error('useSplitActions is only for inside the split page');
  return value;
}

const CONVERT_POLL_MS = 3000;

// Loads a split and keeps it current: a copy saved on the device shows first, other
// people's changes arrive live, and this device's changes show straight away and are
// saved in the background (useSaveQueue).
export function useSplit(splitId: string) {
  const { state, dispatch } = useSplitState();
  const [status, setStatus] = useState<SyncStatus>('loading');
  const [meta, setMeta] = useState<SplitMeta | null>(null);
  const metaRef = useRef(meta);
  metaRef.current = meta;

  const cacheKey = splitCacheKey(splitId);
  // What's on screen, for checking changes before they're queued
  const current = useRef<SplitState>(state);
  current.current = state;

  const { saves, waiting } = useSaveQueue(splitId, {
    setStatus,
    reload: () => load(),
    loadFailed: (err) => backgroundLoadFailed(err),
  });

  /** Deleted, or no longer shared with this person: the device's copy goes too */
  const markGone = useCallback(() => {
    void removeCacheEntry(cacheKey);
    void reloadMySplits();
    setStatus('notfound');
  }, [cacheKey]);
  const isGone = (err: unknown) => err instanceof ApiError && err.status === 404;

  /** A load in the background failed: the split may be gone; otherwise it's tried later */
  const backgroundLoadFailed = useCallback(
    (err: unknown) => {
      if (isGone(err)) markGone();
      else if (isOfflineFailure(err)) setStatus('offline');
      else console.error(err);
    },
    [markGone],
  );

  const show = useCallback(
    ({ people, items, ...rest }: SplitDetail) => {
      setMeta(rest);
      dispatch({ type: 'LOAD_STATE', payload: { people, items } });
    },
    [dispatch],
  );

  const load = useCallback(async () => {
    // Fails straight away offline (the cached copy stays), rather than waiting
    if (isOffline()) throw new NetworkError('Offline');
    // A split made a moment ago may still be on its way to the server
    await whenCreated(splitId);
    for (;;) {
      const seen = saves.sentCount();
      const detail = await api.getSplit(splitId);
      if (seen !== saves.sentCount()) continue;
      if (saves.busy()) {
        // Showing this would hide the unsaved changes; fetch again after saving
        saves.reloadAfterSave();
        return;
      }
      show(detail);
      return;
    }
  }, [splitId, show, saves]);

  useEffect(() => {
    let cancelled = false;
    // Set once the server has answered, even with an error, so the cache can't override it
    let answered = false;
    setStatus('loading');
    setMeta(null);

    // Show the last-seen copy straight away, unless the server has already answered
    void readCache<SplitDetail>(cacheKey).then((cached) => {
      if (cached == null || cancelled || answered) return;
      show(cached);
      setStatus('refreshing');
    });

    saves
      .pickUpOutbox()
      .then(() => load())
      .then(() => {
        answered = true;
        if (!cancelled && !saves.busy()) setStatus('saved');
      })
      .catch((err) => {
        answered = true;
        if (cancelled) return;
        if (isGone(err)) return markGone();
        console.error(err);
        setStatus(isOfflineFailure(err) ? 'offline' : 'error');
      });

    return () => {
      cancelled = true;
    };
  }, [load, show, saves, cacheKey, markGone]);

  // Back online, or back to the app: send what's waiting and catch up straight away
  // rather than at the next retry
  useEffect(() => {
    const resume = () => {
      if (document.visibilityState !== 'visible' || isOffline()) return;
      if (saves.resume()) return;
      if (status === 'offline' || status === 'error') {
        load()
          .then(() => setStatus('saved'))
          .catch(backgroundLoadFailed);
      }
    };
    const offline = () => {
      // A retry would only fail; the 'online' event picks things up instead
      saves.pause();
      setStatus('offline');
    };
    window.addEventListener('online', resume);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [saves, load, status, backgroundLoadFailed]);

  // Keep the cached copy in step with what's on screen, unsaved changes included: they're
  // in the outbox too, so reopening shows them while they're sent
  useEffect(() => {
    if (status === 'loading' || status === 'refreshing' || status === 'notfound') return;
    if (meta == null) return;
    void writeCache<SplitDetail>(cacheKey, {
      ...meta,
      people: state.people,
      items: state.items.map(toApiItem),
    });
  }, [status, meta, state.people, state.items, cacheKey]);

  // Refresh members and invites after sharing changes, without touching people/items
  // Failures are handled here (a split gone shows as gone), so callers needn't
  const refreshMeta = useCallback(async () => {
    try {
      const { people, items, ...rest } = await api.getSplit(splitId);
      setMeta(rest);
    } catch (err) {
      backgroundLoadFailed(err);
    }
  }, [splitId, backgroundLoadFailed]);

  // Everything besides the bill that the split page changes, each in its own way, so
  // nothing outside edits meta directly
  const metaChanges = useMemo<MetaChanges>(
    () => ({
      addAttachment: (photo) =>
        setMeta((m) => (m ? { ...m, attachments: [...m.attachments, photo] } : m)),
      removeAttachment: (id) =>
        setMeta((m) => (m ? { ...m, attachments: m.attachments.filter((a) => a.id !== id) } : m)),
      forgetItemAttachments: (itemId) =>
        setMeta((m) =>
          m ? { ...m, attachments: m.attachments.filter((a) => a.itemId !== itemId) } : m,
        ),
      patchSettings: (changes) => {
        setMeta((m) => (m ? { ...m, ...changes } : m));
        patchListedSplit(splitId, changes);
      },
      removeMember: (email) =>
        setMeta((m) => (m ? { ...m, members: m.members.filter((x) => x.email !== email) } : m)),
      setDistributor: (personId) => setMeta((m) => (m ? { ...m, distributorId: personId } : m)),
      changeSharing: (show, request) => {
        setMeta((m) => (m ? show(m) : m));
        request().catch((err: unknown) => {
          showError(err, 'Something went wrong');
          void refreshMeta();
        });
      },
    }),
    [refreshMeta, splitId],
  );

  // The same rules the server applies, checked here so mistakes are explained instantly
  const actions = useMemo(
    () =>
      makeSplitActions({
        current: () => current.current,
        meta: () => metaRef.current,
        dispatch,
        queue: saves.queue,
        metaChanges,
        reloadAfterSave: saves.reloadAfterSave,
      }),
    [dispatch, saves, metaChanges],
  );

  // While the server converts the items into a new currency, fetch them until it's done
  const converting = meta?.converting ?? false;
  useEffect(() => {
    if (!converting) return;
    const timer = setInterval(() => void load().catch(backgroundLoadFailed), CONVERT_POLL_MS);
    return () => {
      clearInterval(timer);
      // Done (or left): the sidebar and My splits show the converted totals
      void reloadMySplits();
    };
  }, [converting, load, backgroundLoadFailed]);

  // Someone else saved a change: fetch the split again. load() waits until this tab's
  // own unsaved changes are saved, so they're never overwritten.
  const onRemoteChange = useCallback(() => {
    load().catch(backgroundLoadFailed);
    // Totals in the sidebar and My splits follow
    void reloadMySplits();
  }, [load, backgroundLoadFailed]);
  useSplitLive(splitId, status !== 'notfound', onRemoteChange);

  /** Tries a failed save again now, rather than waiting for the automatic retry */
  const retry = useCallback(() => void saves.save(), [saves]);

  return {
    status,
    waiting,
    meta,
    metaChanges,
    refreshMeta,
    actions,
    retry,
    whenSaved: saves.whenSaved,
  };
}
