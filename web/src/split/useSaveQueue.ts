import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { Change } from '../../../shared/types';
import { reloadHomeData } from '../home-data';
import { whenCreated } from '../offline/pending-creates';
import {
  Queued,
  classifySaveFailure,
  isNetworkError,
  isOffline,
  readOutbox,
  requestBackgroundSync,
  stillToSend,
  withOutbox,
  writeOutbox,
} from '../offline/outbox';
import { queryClient } from '../query-client';
import { newId } from '../utils/id';
import { showError } from '../utils/notify';
import { ITEM_NAMES_KEY } from './item-names';
import type { SyncStatus } from './useSplit';

/** Changes are sent together once there's been a pause this long */
const SAVE_DELAY_MS = 500;
/** Retries after network trouble wait this long, doubling each time up to the max */
const RETRY_DELAY_MS = 3000;
const MAX_RETRY_DELAY_MS = 60_000;
/** How long whenSaved waits before giving up */
const WHEN_SAVED_TIMEOUT_MS = 20_000;

export interface SaveQueueEvents {
  setStatus: (status: SyncStatus) => void;
  /** Fetches the split again: after a refusal, or once saved when asked to */
  reload: () => Promise<void>;
  /** The split is gone: deleted, or this person was removed from it */
  onGone: () => void;
}

/**
 * Saves a split's changes in batches. The server checks each batch against the split's
 * current contents; if it refuses one (say, someone else removed a person you just
 * used), everything queued after it is dropped and the split reloaded. Unsent changes
 * are also kept on the device (the outbox), so they survive going offline or the app
 * closing; the service worker sends them if the app isn't open.
 */
export function useSaveQueue(splitId: string, events: SaveQueueEvents) {
  const latest = useRef(events);
  latest.current = events;

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
  // Everyone waiting in whenSaved, told once nothing is left to send
  const savedWaiters = useRef<(() => void)[]>([]);

  const settled = useCallback(() => {
    for (const resolve of savedWaiters.current.splice(0)) resolve();
  }, []);

  /**
   * Brings the outbox in step with what's waiting here. Call holding the outbox lock.
   * Returns true if the service worker sent some while this page was asleep.
   */
  const syncOutbox = useCallback(async () => {
    const inOutbox = new Set((await readOutbox(splitId)).map((q) => q.cid));
    const { left, sentElsewhere } = stillToSend(pending.current, stored.current, inOutbox);
    pending.current = left;
    await writeOutbox(splitId, left);
    stored.current = new Set(left.map((q) => q.cid));
    setWaiting(left.length);
    return sentElsewhere;
  }, [splitId]);

  /**
   * A batch that didn't reach the server, or that the server refused. True when it's
   * kept to send again later.
   */
  const failed = useCallback(
    async (err: unknown, batch: Queued[]): Promise<boolean> => {
      const { setStatus, reload, onGone } = latest.current;
      const kind = classifySaveFailure(err);
      if (kind === 'gone') {
        pending.current = [];
        void withOutbox(splitId, syncOutbox);
        onGone();
        settled();
        return false;
      }
      if (kind === 'refused') {
        // Everything queued after it was built on top of it, so start over
        showError(err, "Couldn't save that change");
        pending.current = [];
        await withOutbox(splitId, syncOutbox);
        reloadAfterSave.current = false;
        try {
          await reload();
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
    [splitId, syncOutbox, settled],
  );

  const save = useCallback(async (): Promise<void> => {
    const { setStatus } = latest.current;
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
      await latest.current.reload().catch((err: unknown) => console.error(err));
    }
  }, [splitId, syncOutbox, settled, failed]);

  const queue = useCallback(
    (change: Change) => {
      const { setStatus } = latest.current;
      pending.current.push({ cid: newId(), change });
      setWaiting(pending.current.length);
      // Kept on the device straight away, in case the app closes before it's sent
      void withOutbox(splitId, syncOutbox);
      if (isOffline()) {
        setStatus('offline');
        requestBackgroundSync();
        return;
      }
      setStatus('saving');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
    },
    [save, splitId, syncOutbox],
  );

  /**
   * Picks up changes left unsent last time (say, made offline), and starts sending
   * them. Call before loading, so the load waits for them rather than hiding them.
   */
  const pickUpOutbox = useCallback(async () => {
    await withOutbox(splitId, async () => {
      const left = await readOutbox(splitId);
      pending.current = [
        ...left,
        ...pending.current.filter((q) => !left.some((l) => l.cid === q.cid)),
      ];
      for (const q of left) stored.current.add(q.cid);
      setWaiting(pending.current.length);
    }).catch(() => undefined);
    if (pending.current.length > 0) void save();
  }, [splitId, save]);

  /**
   * Saves anything queued now, resolving once everything is saved or refused (photos
   * need their item saved first); gives up after 20 seconds
   */
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

  const saves = useMemo(
    () => ({
      queue,
      save,
      whenSaved,
      pickUpOutbox,
      /** Changes waiting or being sent: a load now would hide them */
      busy: () => pending.current.length > 0 || inFlight.current,
      /** Batches sent so far: a load begun before the latest one is out of date */
      sentCount: () => batchesSent.current,
      /** Fetches the split again once everything is saved */
      reloadAfterSave: () => {
        reloadAfterSave.current = true;
      },
      /** Back online or on screen: retry straight away, rather than at the next retry */
      resume: () => {
        failures.current = 0;
        if (pending.current.length === 0) return false;
        void save();
        return true;
      },
      /** Gone offline: a retry would only fail */
      pause: () => clearTimeout(timer.current),
    }),
    [queue, save, whenSaved, pickUpOutbox],
  );
  // Apart, since it changes while the functions above don't
  return { saves, waiting };
}
