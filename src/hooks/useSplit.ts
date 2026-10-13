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
import { IPerson } from '../interfaces/app-reducer';

export type SyncStatus = 'loading' | 'saving' | 'saved' | 'error' | 'notfound';

export type SplitMeta = Omit<SplitDetail, 'people' | 'items'>;

export interface SplitActions {
  addPerson: (name: string, memberEmail?: string) => Promise<boolean>;
  removePerson: (personId: string) => Promise<boolean>;
  clearPeople: () => Promise<boolean>;
  addItem: (item: ItemInput) => Promise<boolean>;
  updateItem: (itemId: string, item: ItemInput) => Promise<boolean>;
  removeItem: (itemId: string) => Promise<boolean>;
  clearItems: () => Promise<boolean>;
  loadTestData: () => Promise<boolean>;
}

/** Provided by the split page. Null outside it, e.g. in modals opened from elsewhere. */
export const SplitActionsContext = createContext<SplitActions | null>(null);

export const useSplitActions = () => useContext(SplitActionsContext);

const TEST_PEOPLE = ['Sean', 'Fei', 'Joshua', 'Naquib', 'Ghuf'];

// Loads a split and sends each change to the server, applying it locally once accepted
export function useSplit(splitId: string) {
  const { state, dispatch } = useContext(AppContext);
  const [status, setStatus] = useState<SyncStatus>('loading');
  const [meta, setMeta] = useState<SplitMeta | null>(null);
  const people = useRef(state.people);
  people.current = state.people;

  const load = useCallback(async () => {
    const { people, items, ...rest } = await api.getSplit(splitId);
    setMeta(rest);
    dispatch({ type: 'LOAD_STATE', payload: { people, items } });
  }, [splitId, dispatch]);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setMeta(null);
    dispatch({ type: 'LOAD_STATE', payload: { people: [], items: [] } });

    load()
      .then(() => !cancelled && setStatus('saved'))
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        setStatus(err instanceof ApiError && err.status === 404 ? 'notfound' : 'error');
      });

    return () => {
      cancelled = true;
    };
  }, [load, dispatch]);

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
      // Adds sample people (reusing any already there) and items
      loadTestData: () =>
        run(
          async () => {
            const byName = new Map(people.current.map((p) => [p.name, p]));
            const ids: string[] = [];
            for (const name of TEST_PEOPLE) {
              const person: IPerson = byName.get(name) ?? (await api.addPerson(splitId, name));
              ids.push(person.id);
            }
            const [sean, fei, joshua, naquib] = ids;
            for (const item of [
              { name: 'Golf Balls', cost: 48, payerId: sean, participantIds: ids },
              { name: 'Golf Balls', cost: 48, payerId: fei, participantIds: ids },
              { name: 'Golf Balls', cost: 16, payerId: joshua, participantIds: [joshua, naquib] },
              { name: 'Water 1.5L', cost: 4, payerId: sean, participantIds: [fei] },
            ]) {
              await api.addItem(splitId, item);
            }
            await load();
          },
          () => undefined,
        ),
    }),
    [run, load, splitId, dispatch],
  );

  return { status, meta, refreshMeta, actions };
}
