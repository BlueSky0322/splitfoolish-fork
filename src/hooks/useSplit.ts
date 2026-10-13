import { notifications } from '@mantine/notifications';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ApiError, Change, ItemInput, SplitDetail, api } from '../api';
import { AppContext } from '../context/AppContext/AppContext';
import { toApiItem } from '../context/AppContext/app-reducer';
import { AppReducerState } from '../interfaces/app-reducer';
import { readCache, removeCache, writeCache } from '../split-cache';

/** 'refreshing' means a cached copy is showing while the latest loads */
export type SyncStatus = 'loading' | 'refreshing' | 'saving' | 'saved' | 'error' | 'notfound';

export type SplitMeta = Omit<SplitDetail, 'people' | 'items'>;

/** Each returns false (after explaining why) when the change isn't allowed */
export interface SplitActions {
  addPerson: (name: string, memberEmail?: string) => boolean;
  removePerson: (personId: string) => boolean;
  clearPeople: () => boolean;
  addItem: (item: ItemInput) => boolean;
  updateItem: (itemId: string, item: ItemInput) => boolean;
  removeItem: (itemId: string) => boolean;
  clearItems: () => boolean;
}

/** Provided by the split page. Null outside it, e.g. in modals opened from elsewhere. */
export const SplitActionsContext = createContext<SplitActions | null>(null);

export const useSplitActions = () => useContext(SplitActionsContext);

/** Changes are sent together once there's been a pause this long */
const SAVE_DELAY_MS = 500;
const RETRY_DELAY_MS = 3000;

const newId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

const refuse = (message: string) => {
  notifications.show({ color: 'red', message });
  return false;
};

// Loads a split, applies changes on screen straight away, and saves them in batches.
// The server checks each batch against the split's current contents; if it refuses
// one (say, someone else removed a person you just used), the split is reloaded.
export function useSplit(splitId: string) {
  const { state, dispatch } = useContext(AppContext);
  const [status, setStatus] = useState<SyncStatus>('loading');
  const [meta, setMeta] = useState<SplitMeta | null>(null);

  const cacheKey = `split:${splitId}`;
  // What's on screen, for checking changes before they're queued
  const current = useRef<AppReducerState>(state);
  current.current = state;

  const pending = useRef<Change[]>([]);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  // Counts batches sent, so a load that raced with a save can tell its data is stale
  const batchesSent = useRef(0);
  // A load that arrived while changes were unsaved is redone once they're saved
  const reloadAfterSave = useRef(false);

  const show = useCallback(
    ({ people, items, ...rest }: SplitDetail) => {
      setMeta(rest);
      dispatch({ type: 'LOAD_STATE', payload: { people, items } });
    },
    [dispatch],
  );

  const load = useCallback(async () => {
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

  const save = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current);
    if (inFlight.current || pending.current.length === 0) return;

    const batch = pending.current;
    pending.current = [];
    inFlight.current = true;
    batchesSent.current += 1;
    setStatus('saving');

    try {
      await api.applyChanges(splitId, batch);
      inFlight.current = false;
      if (pending.current.length > 0) return save();
      setStatus('saved');
      if (reloadAfterSave.current) {
        reloadAfterSave.current = false;
        await load();
      }
    } catch (err) {
      inFlight.current = false;
      if (err instanceof ApiError) {
        // Refused: everything queued after it was built on top of it, so start over
        notifications.show({ color: 'red', message: err.message });
        pending.current = [];
        reloadAfterSave.current = false;
        await load().catch(() => undefined);
        setStatus('saved');
        return;
      }
      // Network trouble: keep the changes and try again
      console.error(err);
      pending.current = [...batch, ...pending.current];
      setStatus('error');
      timer.current = setTimeout(save, RETRY_DELAY_MS);
    }
  }, [splitId, load]);

  const queue = useCallback(
    (change: Change) => {
      pending.current.push(change);
      setStatus('saving');
      clearTimeout(timer.current);
      timer.current = setTimeout(save, SAVE_DELAY_MS);
      return true;
    },
    [save],
  );

  useEffect(() => {
    let cancelled = false;
    // Set once the server has answered, even with an error, so the cache can't override it
    let answered = false;
    setStatus('loading');
    setMeta(null);
    dispatch({ type: 'LOAD_STATE', payload: { people: [], items: [] } });

    // Show the last-seen copy straight away, unless the server has already answered
    readCache<SplitDetail>(cacheKey).then((cached) => {
      if (cached == null || cancelled || answered) return;
      show(cached);
      setStatus('refreshing');
    });

    load()
      .then(() => {
        answered = true;
        if (!cancelled && pending.current.length === 0 && !inFlight.current) setStatus('saved');
      })
      .catch((err) => {
        answered = true;
        const gone = err instanceof ApiError && err.status === 404;
        // Deleted, or no longer shared with this person: drop the local copy too
        if (gone) removeCache(cacheKey);
        if (cancelled) return;
        console.error(err);
        setStatus(gone ? 'notfound' : 'error');
      });

    return () => {
      cancelled = true;
    };
  }, [load, show, cacheKey, dispatch]);

  // Save right away when leaving the split or hiding the page, rather than waiting
  useEffect(() => {
    const saveNow = () => {
      if (document.visibilityState === 'hidden') save();
    };
    document.addEventListener('visibilitychange', saveNow);
    window.addEventListener('pagehide', save);
    return () => {
      document.removeEventListener('visibilitychange', saveNow);
      window.removeEventListener('pagehide', save);
      save();
    };
  }, [save]);

  // Keep the cached copy in step with what's on screen once it's confirmed by the server
  useEffect(() => {
    if (status !== 'saved' || meta == null) return;
    writeCache<SplitDetail>(cacheKey, {
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

  // The same rules the server applies, checked here so mistakes are explained instantly
  const actions = useMemo<SplitActions>(
    () => ({
      addPerson: (name, memberEmail) => {
        const trimmed = name.trim();
        if (trimmed === '') return false;
        if (current.current.people.some((p) => p.name === trimmed)) {
          return refuse(`${trimmed} is already in this split`);
        }
        const person = { id: newId(), name: trimmed, memberEmail: memberEmail ?? null };
        dispatch({ type: 'ADD_PERSON', payload: person });
        return queue({ op: 'addPerson', ...person });
      },
      removePerson: (personId) => {
        const person = current.current.people.find((p) => p.id === personId);
        if (person == null) return false;
        const uses = current.current.items.filter(
          (i) => i.payer.id === personId || i.participants.some((p) => p.id === personId),
        ).length;
        if (uses > 0) {
          const items = uses === 1 ? '1 item' : `${uses} items`;
          return refuse(`${person.name} is on ${items}. Edit or remove those items first.`);
        }
        dispatch({ type: 'REMOVE_PERSON', payload: personId });
        return queue({ op: 'removePerson', id: personId });
      },
      clearPeople: () => {
        if (current.current.items.length > 0) {
          return refuse('Remove the items first, then clear the people.');
        }
        dispatch({ type: 'CLEAR_PEOPLE', payload: null });
        return queue({ op: 'clearPeople' });
      },
      addItem: (input) => {
        const item = { id: newId(), ...input };
        dispatch({ type: 'ADD_ITEM', payload: item });
        return queue({ op: 'addItem', item });
      },
      updateItem: (itemId, input) => {
        const item = { id: itemId, ...input };
        dispatch({ type: 'UPDATE_ITEM', payload: item });
        return queue({ op: 'updateItem', item });
      },
      removeItem: (itemId) => {
        dispatch({ type: 'REMOVE_ITEM', payload: itemId });
        return queue({ op: 'removeItem', id: itemId });
      },
      clearItems: () => {
        dispatch({ type: 'CLEAR_ITEMS', payload: null });
        return queue({ op: 'clearItems' });
      },
    }),
    [dispatch, queue],
  );

  return { status, meta, refreshMeta, actions };
}
