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
import { ApiError, ItemInput, SplitDetail, api } from '../api';
import { AppContext } from '../context/AppContext/AppContext';
import { toApiItem } from '../context/AppContext/app-reducer';
import { readCache, removeCache, writeCache } from '../split-cache';

/** 'refreshing' means a cached copy is showing while the latest loads */
export type SyncStatus = 'loading' | 'refreshing' | 'saving' | 'saved' | 'error' | 'notfound';

export type SplitMeta = Omit<SplitDetail, 'people' | 'items'>;

export interface SplitActions {
  addPerson: (name: string, memberEmail?: string) => Promise<boolean>;
  removePerson: (personId: string) => Promise<boolean>;
  clearPeople: () => Promise<boolean>;
  addItem: (item: ItemInput) => Promise<boolean>;
  updateItem: (itemId: string, item: ItemInput) => Promise<boolean>;
  removeItem: (itemId: string) => Promise<boolean>;
  clearItems: () => Promise<boolean>;
}

/** Provided by the split page. Null outside it, e.g. in modals opened from elsewhere. */
export const SplitActionsContext = createContext<SplitActions | null>(null);

export const useSplitActions = () => useContext(SplitActionsContext);

// Loads a split and sends each change to the server, applying it locally once accepted
export function useSplit(splitId: string) {
  const { state, dispatch } = useContext(AppContext);
  const [status, setStatus] = useState<SyncStatus>('loading');
  const [meta, setMeta] = useState<SplitMeta | null>(null);

  const cacheKey = `split:${splitId}`;
  // Counts changes sent, so a load that raced with an edit can tell its data is stale
  const changesSent = useRef(0);

  const show = useCallback(
    ({ people, items, ...rest }: SplitDetail) => {
      setMeta(rest);
      dispatch({ type: 'LOAD_STATE', payload: { people, items } });
    },
    [dispatch],
  );

  const load = useCallback(async () => {
    for (;;) {
      const seen = changesSent.current;
      const detail = await api.getSplit(splitId);
      if (seen !== changesSent.current) continue;
      show(detail);
      return;
    }
  }, [splitId, show]);

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
        if (!cancelled) setStatus('saved');
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

  // Runs one change. A refused change (e.g. removing someone who is on an item) is
  // explained in a notification, and the split is reloaded in case someone else
  // changed it meanwhile.
  const run = useCallback(
    async <T>(request: () => Promise<T>, apply: (result: T) => void): Promise<boolean> => {
      setStatus('saving');
      changesSent.current += 1;
      try {
        apply(await request());
        setStatus('saved');
        return true;
      } catch (err) {
        if (!(err instanceof ApiError)) {
          console.error(err);
          setStatus('error');
          return false;
        }
        notifications.show({ color: 'red', message: err.message });
        await load().catch(() => undefined);
        setStatus('saved');
        return false;
      }
    },
    [load],
  );

  const actions = useMemo<SplitActions>(
    () => ({
      addPerson: (name, memberEmail) =>
        run(
          () => api.addPerson(splitId, name, memberEmail),
          (person) => dispatch({ type: 'ADD_PERSON', payload: person }),
        ),
      removePerson: (personId) =>
        run(
          () => api.removePerson(splitId, personId),
          () => dispatch({ type: 'REMOVE_PERSON', payload: personId }),
        ),
      clearPeople: () =>
        run(
          () => api.clearPeople(splitId),
          () => dispatch({ type: 'CLEAR_PEOPLE', payload: null }),
        ),
      addItem: (item) =>
        run(
          () => api.addItem(splitId, item),
          (saved) => dispatch({ type: 'ADD_ITEM', payload: saved }),
        ),
      updateItem: (itemId, item) =>
        run(
          () => api.updateItem(splitId, itemId, item),
          (saved) => dispatch({ type: 'UPDATE_ITEM', payload: saved }),
        ),
      removeItem: (itemId) =>
        run(
          () => api.removeItem(splitId, itemId),
          () => dispatch({ type: 'REMOVE_ITEM', payload: itemId }),
        ),
      clearItems: () =>
        run(
          () => api.clearItems(splitId),
          () => dispatch({ type: 'CLEAR_ITEMS', payload: null }),
        ),
    }),
    [run, load, splitId, dispatch],
  );

  return { status, meta, refreshMeta, actions };
}
