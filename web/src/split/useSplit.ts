import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ApiError, api } from '../api';
import type { Change } from '../../../shared/types';
import { SplitState, toApiItem, type StoredItem, type SplitMeta } from './state';
import { readCache, removeCache, writeCache } from '../offline/cache';
import { whenCreated } from '../offline/pending-creates';
import {
  Queued,
  isNetworkError,
  isOffline,
  readOutbox,
  requestBackgroundSync,
  withOutbox,
  writeOutbox,
  saveFailure,
  stillToSend,
} from '../offline/outbox';
import { queryClient } from '../query-client';
import { ITEM_NAMES_KEY } from './item-names';
import { useSplitLive } from './useSplitLive';
import type { SplitDetail, Attachment } from '../../../shared/api';
import { reloadHomeData } from '../home-data';
import { showRefusal, showError } from '../utils/notify';
import { SplitActions, makeSplitActions } from './actions';
import { newId } from '../utils/id';
import { useSplitState } from './SplitStateContext';

/** A split as this device keeps it: an older copy's items may predate some fields */
type CachedSplit = Omit<SplitDetail, 'items'> & { items: StoredItem[] };

/**
 * 'refreshing' means a cached copy is showing while the latest loads; 'offline' that
 * there's no connection, with any changes kept on the device until there is
 */
export type SyncStatus =
  | 'loading'
  | 'refreshing'
  | 'saving'
  | 'saved'
  | 'error'
  | 'offline'
  | 'notfound';

export type { SplitMeta };

/** The ways the split page changes what it shows about the split besides its bill */
export interface MetaChanges {
  addAttachment: (photo: Attachment) => void;
  removeAttachment: (id: string) => void;
  /** Photos of an item that was deleted (the server removed them with it) */
  forgetItemAttachments: (itemId: string) => void;
  /** Shows saved split settings straight away */
  patchSettings: (
    changes: Partial<Pick<SplitMeta, 'name' | 'currency' | 'pictureVersion' | 'converting'>>,
  ) => void;
  /** Shows a sharing change straight away; fetches it again if the server says no */
  changeSharing: (show: (meta: SplitMeta) => SplitMeta, request: () => Promise<unknown>) => void;
}

/** Provided by the split page. Null outside it, e.g. in modals opened from elsewhere. */
export const SplitActionsContext = createContext<SplitActions | null>(null);

export const useSplitActions = () => useContext(SplitActionsContext);

/** Changes are sent together once there's been a pause this long */
const SAVE_DELAY_MS = 500;
/** Retries after network trouble wait this long, doubling each time up to the max */
const RETRY_DELAY_MS = 3000;
const MAX_RETRY_DELAY_MS = 60_000;
const CONVERT_POLL_MS = 3000;
/** How long whenSaved waits before giving up */
const WHEN_SAVED_TIMEOUT_MS = 20_000;

// Loads a split, applies changes on screen straight away, and saves them in batches.
// The server checks each batch against the split's current contents; if it refuses
// one (say, someone else removed a person you just used), the split is reloaded.
// Unsaved changes are also kept on the device (the outbox), so they survive going
// offline or the app closing; the service worker sends them if the app isn't open.
export function useSplit(splitId: string) {
  const { state, dispatch } = useSplitState();
  const [status, setStatus] = useState<SyncStatus>('loading');
  const [meta, setMeta] = useState<SplitMeta | null>(null);
  const metaRef = useRef(meta);
  metaRef.current = meta;

  const cacheKey = `split:${splitId}`;
  // What's on screen, for checking changes before they're queued
  const current = useRef<SplitState>(state);
  current.current = state;

  const pending = useRef<Queued[]>([]);
  // Changes written to the outbox; one that's gone from there was sent by the service worker
  const stored = useRef(new Set<string>());
  // How many changes are waiting, for showing while offline
  const [waiting, setWaiting] = useState(0);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const failures = useRef(0);
  // Counts batches sent, so a load that raced with a save can tell its data is stale
  const batchesSent = useRef(0);
  // A load that arrived while changes were unsaved is redone once they're saved
  const reloadAfterSave = useRef(false);

  const show = useCallback(
    ({ people, items, ...rest }: CachedSplit) => {
      setMeta(rest);
      dispatch({ type: 'LOAD_STATE', payload: { people, items } });
    },
    [dispatch],
  );

  const load = useCallback(async () => {
    // Fails straight away offline (the cached copy stays), rather than waiting
    if (isOffline()) throw new TypeError('Offline');
    // A split made a moment ago may still be on its way to the server
    await whenCreated(splitId);
    for (;;) {
      const seen = batchesSent.current;
      const detail = await api.getSplit(splitId);
      if (seen !== batchesSent.current) continue;
      if (pending.current.length > 0 || inFlight.current) {
        // Showing this would hide the unsaved changes; fetch again after saving
        reloadAfterSave.current = true;
        return;
      }
      show(detail);
      return;
    }
  }, [splitId, show]);

  /**
   * Brings the outbox in step with what's waiting here. Call holding the outbox lock.
   * Returns true if the service worker sent some while this page was asleep.
   */
  const syncOutbox = useCallback(async () => {
    const inOutbox = new Set((await readOutbox(splitId)).map((q) => q.cid));
    const { left, sentElsewhere } = stillToSend(pending.current, stored.current, inOutbox);
    pending.current = left;
    const now = left;
    await writeOutbox(splitId, now);
    stored.current = new Set(now.map((q) => q.cid));
    setWaiting(pending.current.length);
    return sentElsewhere;
  }, [splitId]);

  // Everyone waiting in whenSaved, told once nothing is left to send
  const savedWaiters = useRef<(() => void)[]>([]);
  const settled = useCallback(() => {
    for (const resolve of savedWaiters.current.splice(0)) resolve();
  }, []);

  /**
   * A batch that didn't reach the server, or that the server refused. True when it's
   * kept to send again later.
   */
  const failed = useCallback(
    async (err: unknown, batch: Queued[]): Promise<boolean> => {
      const kind = saveFailure(err);
      // Removed from the split (or it was deleted) while it was open
      if (kind === 'gone') {
        pending.current = [];
        void withOutbox(splitId, syncOutbox);
        void removeCache(cacheKey);
        void reloadHomeData();
        setStatus('notfound');
        settled();
        return false;
      }
      if (kind === 'refused') {
        // Refused: everything queued after it was built on top of it, so start over
        showRefusal((err as Error).message);
        pending.current = [];
        await withOutbox(splitId, syncOutbox);
        reloadAfterSave.current = false;
        try {
          await load();
          setStatus('saved');
        } catch (loadErr) {
          setStatus(isNetworkError(loadErr) ? 'offline' : 'error');
        }
        settled();
        return false;
      }
      // Not the change's fault (no connection, busy, a problem on the server's side):
      // keep the changes (they're still in the outbox) and try again, less often the
      // longer it lasts
      console.error(err);
      pending.current = [...batch, ...pending.current];
      setWaiting(pending.current.length);
      requestBackgroundSync();
      setStatus(isNetworkError(err) ? 'offline' : 'error');
      return !isOffline();
    },
    [splitId, syncOutbox, cacheKey, load, settled],
  );

  const save = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current);
    if (inFlight.current || pending.current.length === 0) return;
    if (isOffline()) {
      // Sent when the connection is back, by this page or the service worker
      setStatus('offline');
      requestBackgroundSync();
      return;
    }

    inFlight.current = true;
    batchesSent.current += 1;
    setStatus('saving');

    let batch: Queued[] = [];
    let sent = false;
    try {
      await whenCreated(splitId);
      // Held while sending, so the service worker can't send the same changes
      await withOutbox(splitId, async () => {
        if (await syncOutbox()) reloadAfterSave.current = true;
        batch = pending.current;
        pending.current = [];
        if (batch.length > 0) {
          await api.applyChanges(
            splitId,
            batch.map((q) => q.change),
          );
        }
        sent = true;
        await syncOutbox();
      });
    } catch (err) {
      inFlight.current = false;
      if (!sent) {
        if (await failed(err, batch)) {
          const delay = Math.min(MAX_RETRY_DELAY_MS, RETRY_DELAY_MS * 2 ** failures.current++);
          timer.current = setTimeout(() => void save(), delay);
        }
        return;
      }
      // Saved; only crossing them off on the device failed, so that's tried again
      console.error(err);
      void withOutbox(splitId, syncOutbox).catch(() => undefined);
    }
    inFlight.current = false;
    failures.current = 0;
    if (pending.current.length > 0) return save();
    setStatus('saved');
    settled();
    // Totals and balances in the sidebar and My splits follow the change
    void reloadHomeData();
    // A new item name is suggested next time
    void queryClient.invalidateQueries({ queryKey: ITEM_NAMES_KEY });
    if (reloadAfterSave.current) {
      reloadAfterSave.current = false;
      await load().catch((err: unknown) => console.error(err));
    }
  }, [splitId, load, syncOutbox, settled, failed]);

  const queue = useCallback(
    (change: Change) => {
      pending.current.push({ cid: newId(), change });
      setWaiting(pending.current.length);
      // Kept on the device straight away, in case the app closes before it's sent
      void withOutbox(splitId, syncOutbox);
      if (isOffline()) {
        setStatus('offline');
        requestBackgroundSync();
        return true;
      }
      setStatus('saving');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
      return true;
    },
    [save, splitId, syncOutbox],
  );

  useEffect(() => {
    let cancelled = false;
    // Set once the server has answered, even with an error, so the cache can't override it
    let answered = false;
    setStatus('loading');
    setMeta(null);

    // Show the last-seen copy straight away, unless the server has already answered
    void readCache<CachedSplit>(cacheKey).then((cached) => {
      if (cached == null || cancelled || answered) return;
      show(cached);
      setStatus('refreshing');
    });

    // Changes left unsent last time (say, made offline) are picked up before loading,
    // so the load waits for them to be saved rather than hiding them
    withOutbox(splitId, async () => {
      const left = await readOutbox(splitId);
      pending.current = [
        ...left,
        ...pending.current.filter((q) => !left.some((l) => l.cid === q.cid)),
      ];
      for (const q of left) stored.current.add(q.cid);
      setWaiting(pending.current.length);
    })
      .catch(() => undefined)
      .then(() => {
        if (pending.current.length > 0) void save();
        return load();
      })
      .then(() => {
        answered = true;
        if (!cancelled && pending.current.length === 0 && !inFlight.current) setStatus('saved');
      })
      .catch((err) => {
        answered = true;
        const gone = err instanceof ApiError && err.status === 404;
        // Deleted, or no longer shared with this person: drop the local copy too
        if (gone) void removeCache(cacheKey);
        if (cancelled) return;
        console.error(err);
        setStatus(gone ? 'notfound' : isNetworkError(err) ? 'offline' : 'error');
      });

    return () => {
      cancelled = true;
    };
  }, [load, show, save, splitId, cacheKey, dispatch]);

  // Back online, or back to the app: send what's waiting and catch up straight away
  // rather than at the next retry
  useEffect(() => {
    const resume = () => {
      if (document.visibilityState !== 'visible' || isOffline()) return;
      failures.current = 0;
      if (pending.current.length > 0) {
        void save();
      } else if (status === 'offline' || status === 'error') {
        load()
          .then(() => setStatus('saved'))
          .catch((err) => console.error(err));
      }
    };
    const offline = () => {
      // A retry would only fail; the 'online' event picks things up instead
      clearTimeout(timer.current);
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
  }, [save, load, status]);

  // Save right away when leaving the split or hiding the page, rather than waiting
  useEffect(() => {
    const saveNow = () => {
      if (document.visibilityState === 'hidden') void save();
    };
    const saveOnHide = () => void save();
    document.addEventListener('visibilitychange', saveNow);
    window.addEventListener('pagehide', saveOnHide);
    return () => {
      document.removeEventListener('visibilitychange', saveNow);
      window.removeEventListener('pagehide', saveOnHide);
      void save();
    };
  }, [save]);

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
  const refreshMeta = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { people, items, ...rest } = await api.getSplit(splitId);
    setMeta(rest);
  }, [splitId]);

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
      patchSettings: (changes) => setMeta((m) => (m ? { ...m, ...changes } : m)),
      changeSharing: (show, request) => {
        setMeta((m) => (m ? show(m) : m));
        request().catch((err: unknown) => {
          showError(err, 'Something went wrong');
          refreshMeta().catch((e: unknown) => console.error(e));
        });
      },
    }),
    [refreshMeta],
  );

  // The same rules the server applies, checked here so mistakes are explained instantly
  const actions = useMemo(
    () =>
      makeSplitActions({
        current: () => current.current,
        meta: () => metaRef.current,
        dispatch,
        queue,
        setMeta,
        reloadAfterSave: () => (reloadAfterSave.current = true),
      }),
    [dispatch, queue],
  );

  /** Tries a failed save again now, rather than waiting for the automatic retry */
  const retry = useCallback(() => {
    void save();
  }, [save]);

  /** Saves anything queued now, resolving once the server has it (photos need their item saved) */
  /** Resolves once everything queued is saved (or refused); gives up after 20 seconds */
  const whenSaved = useCallback(() => {
    if (pending.current.length === 0 && !inFlight.current) return Promise.resolve();
    const saved = new Promise<void>((resolve) => savedWaiters.current.push(resolve));
    void save();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const tooLong = new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error('Still saving. Try again in a moment.')),
        WHEN_SAVED_TIMEOUT_MS,
      );
    });
    return Promise.race([saved, tooLong]).finally(() => clearTimeout(timeout));
  }, [save]);

  // While the server converts the items into a new currency, fetch them until it's done
  const converting = meta?.converting ?? false;
  useEffect(() => {
    if (!converting) return;
    const timer = setInterval(() => {
      load().catch((err) => console.error(err));
    }, CONVERT_POLL_MS);
    return () => {
      clearInterval(timer);
      // Done (or left): the sidebar and My splits show the converted totals
      void reloadHomeData();
    };
  }, [converting, load]);

  // Someone else saved a change: fetch the split again. load() waits until this tab's
  // own unsaved changes are saved, so they're never overwritten.
  const onRemoteChange = useCallback(() => {
    load().catch((err) => console.error(err));
    // Totals in the sidebar and My splits follow
    void reloadHomeData();
  }, [load]);
  useSplitLive(splitId, status !== 'notfound', onRemoteChange);

  return { status, waiting, meta, metaChanges, refreshMeta, actions, retry, whenSaved };
}
