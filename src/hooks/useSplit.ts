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
import { ApiItem, toApiItem } from '../context/AppContext/app-reducer';
import { convertCents, convertParts } from '../../shared/rates';
import { AppReducerState, IItem } from '../interfaces/app-reducer';
import { readCache, removeCache, writeCache } from '../split-cache';
import { whenCreated } from '../pending-creates';
import { reloadHomeData } from './useHomeData';

/** 'refreshing' means a cached copy is showing while the latest loads */
export type SyncStatus = 'loading' | 'refreshing' | 'saving' | 'saved' | 'error' | 'notfound';

export type SplitMeta = Omit<SplitDetail, 'people' | 'items'>;

/** Each returns false (after explaining why) when the change isn't allowed */
export interface SplitActions {
  addPerson: (name: string, memberEmail?: string) => boolean;
  renamePerson: (personId: string, name: string) => boolean;
  /** "This is me": links a person to an account, or unlinks with null */
  linkPerson: (personId: string, memberEmail: string | null) => boolean;
  /** fromItems also takes them off items they share; see removeBlocker for what's allowed */
  removePerson: (personId: string, fromItems?: boolean) => boolean;
  clearPeople: () => boolean;
  /** id lets the caller refer to the new item straight away, say to attach photos */
  addItem: (item: ItemInput, id?: string) => boolean;
  updateItem: (itemId: string, item: ItemInput) => boolean;
  removeItem: (itemId: string) => boolean;
  /** Who everyone settles up through, or null for the fewest transfers */
  setDistributor: (personId: string | null) => boolean;
  /** Puts back an item that was just removed (Undo) */
  restoreItem: (item: ApiItem) => boolean;
  clearItems: () => boolean;
  /** Converts items in these currencies again at today's rate, leaving typed rates */
  refreshRates: (currencies: string[]) => boolean;
  /** Every item in a currency at a typed rate, or today's rate when null */
  setRate: (currency: string, rate: number | null) => boolean;
}

/** Provided by the split page. Null outside it, e.g. in modals opened from elsewhere. */
export const SplitActionsContext = createContext<SplitActions | null>(null);

export const useSplitActions = () => useContext(SplitActionsContext);

/** Changes are sent together once there's been a pause this long */
const SAVE_DELAY_MS = 500;
const RETRY_DELAY_MS = 3000;
const CONVERT_POLL_MS = 3000;

export const newId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

const refuse = (message: string) => {
  notifications.show({ color: 'red', message });
  return false;
};

/** An item paid in another currency, converted again at a typed rate, as the server does it */
function atRate(item: IItem, rate: number): IItem {
  const original = item.original!;
  const costCents = convertCents(Math.round(original.amount * 100), rate);
  const exact =
    item.splitMode === 'exact' && original.exact
      ? Object.fromEntries(
          [
            ...convertParts(
              Object.entries(original.exact).map(([id, amount]) => [id, Math.round(amount * 100)]),
              rate,
              costCents,
            ),
          ].map(([id, cents]) => [id, cents / 100]),
        )
      : item.exact;
  return {
    ...item,
    cost: costCents / 100,
    exact,
    original: { ...original, rate, rateSource: 'manual', rateAt: Date.now() },
  };
}

/**
 * Why a person can't be removed, or null if they can. Mirrors the server: someone who
 * paid for anything stays; with fromItems they come off items they share, unless that
 * would leave an item with nobody or break an exact split.
 */
export function removeBlocker(
  state: AppReducerState,
  personId: string,
  fromItems: boolean,
): string | null {
  const person = state.people.find((p) => p.id === personId);
  if (person == null) return null;
  const count = (n: number) => (n === 1 ? '1 item' : `${n} items`);
  const paid = state.items.filter((i) => i.payer.id === personId).length;
  if (paid > 0) return `${person.name} paid for ${count(paid)}. Edit or remove those items first.`;
  const shared = state.items.filter((i) => i.participants.some((p) => p.id === personId));
  if (shared.length === 0) return null;
  if (!fromItems) return `${person.name} is on ${count(shared.length)}.`;
  if (shared.some((i) => i.participants.length === 1)) {
    return `${person.name} is the only person on an item. Edit or remove it first.`;
  }
  if (shared.some((i) => i.splitMode === 'exact')) {
    return `${person.name} is on an item split by exact amounts. Edit that item first.`;
  }
  return null;
}

// Loads a split, applies changes on screen straight away, and saves them in batches.
// The server checks each batch against the split's current contents; if it refuses
// one (say, someone else removed a person you just used), the split is reloaded.
export function useSplit(splitId: string) {
  const { state, dispatch } = useContext(AppContext);
  const [status, setStatus] = useState<SyncStatus>('loading');
  const [meta, setMeta] = useState<SplitMeta | null>(null);
  const metaRef = useRef(meta);
  metaRef.current = meta;

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

  const save = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current);
    if (inFlight.current || pending.current.length === 0) return;

    const batch = pending.current;
    pending.current = [];
    inFlight.current = true;
    batchesSent.current += 1;
    setStatus('saving');

    try {
      await whenCreated(splitId);
      await api.applyChanges(splitId, batch);
      inFlight.current = false;
      if (pending.current.length > 0) return save();
      setStatus('saved');
      // Totals and balances in the sidebar and My splits follow the change
      void reloadHomeData();
      if (reloadAfterSave.current) {
        reloadAfterSave.current = false;
        await load();
      }
    } catch (err) {
      inFlight.current = false;
      // Removed from the split (or it was deleted) while it was open
      if (err instanceof ApiError && err.status === 404) {
        pending.current = [];
        void removeCache(cacheKey);
        void reloadHomeData();
        setStatus('notfound');
        return;
      }
      // No exchange rate yet (503) or too many changes this minute (429): nothing was
      // wrong with the change itself, so it's kept and sent again
      if (err instanceof ApiError && err.status !== 503 && err.status !== 429) {
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
      timer.current = setTimeout(() => void save(), RETRY_DELAY_MS);
    }
  }, [splitId, load, cacheKey]);

  const queue = useCallback(
    (change: Change) => {
      pending.current.push(change);
      setStatus('saving');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
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
    void readCache<SplitDetail>(cacheKey).then((cached) => {
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
        if (gone) void removeCache(cacheKey);
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

  // Keep the cached copy in step with what's on screen once it's confirmed by the server
  useEffect(() => {
    if (status !== 'saved' || meta == null) return;
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
      renamePerson: (personId, name) => {
        const trimmed = name.trim();
        const person = current.current.people.find((p) => p.id === personId);
        if (person == null || trimmed === '' || trimmed === person.name) return false;
        if (person.memberEmail != null) {
          return refuse(`${person.name}'s name comes from their account`);
        }
        if (current.current.people.some((p) => p.name === trimmed && p.id !== personId)) {
          return refuse(`${trimmed} is already in this split`);
        }
        dispatch({ type: 'UPDATE_PERSON', payload: { id: personId, name: trimmed } });
        return queue({ op: 'renamePerson', id: personId, name: trimmed });
      },
      linkPerson: (personId, memberEmail) => {
        const people = current.current.people;
        const person = people.find((p) => p.id === personId);
        if (person == null) return false;
        if (memberEmail != null) {
          const other = people.find((p) => p.memberEmail === memberEmail && p.id !== personId);
          if (other) return refuse(`That account is already ${other.name}`);
          if (person.memberEmail != null && person.memberEmail !== memberEmail) {
            return refuse(`${person.name} is already linked to another account`);
          }
        }
        // Linked people go by their account's display name, as the server shows them
        const displayName = metaRef.current?.members.find(
          (m) => m.email === memberEmail,
        )?.displayName;
        dispatch({
          type: 'UPDATE_PERSON',
          payload: { id: personId, memberEmail, ...(displayName ? { name: displayName } : {}) },
        });
        return queue({ op: 'linkPerson', id: personId, memberEmail });
      },
      removePerson: (personId, fromItems = false) => {
        const person = current.current.people.find((p) => p.id === personId);
        if (person == null) return false;
        const blocker = removeBlocker(current.current, personId, fromItems);
        if (blocker) return refuse(blocker);
        dispatch({ type: 'REMOVE_PERSON', payload: personId });
        // Someone with an account loses access too, and the share link changes
        const email = person.memberEmail;
        if (
          email != null &&
          metaRef.current?.members.some((m) => m.email === email && m.role !== 'owner')
        ) {
          setMeta((m) => (m ? { ...m, members: m.members.filter((x) => x.email !== email) } : m));
          reloadAfterSave.current = true;
        }
        return queue({ op: 'removePerson', id: personId, fromItems });
      },
      clearPeople: () => {
        if (current.current.items.length > 0) {
          return refuse('Remove the items first, then clear the people.');
        }
        dispatch({ type: 'CLEAR_PEOPLE', payload: null });
        return queue({ op: 'clearPeople' });
      },
      addItem: (input, id = newId()) => {
        // The server stamps its own time; this one orders it until the next load
        const item = { id, createdAt: Date.now(), ...input };
        dispatch({ type: 'ADD_ITEM', payload: item });
        // In another currency the server works out the amounts; show its numbers after
        if (input.original) reloadAfterSave.current = true;
        return queue({ op: 'addItem', item });
      },
      updateItem: (itemId, input) => {
        const existing = current.current.items.find((i) => i.id === itemId);
        const item = { id: itemId, createdAt: existing?.createdAt ?? Date.now(), ...input };
        dispatch({ type: 'UPDATE_ITEM', payload: item });
        if (input.original || existing?.original) reloadAfterSave.current = true;
        return queue({ op: 'updateItem', item });
      },
      removeItem: (itemId) => {
        dispatch({ type: 'REMOVE_ITEM', payload: itemId });
        return queue({ op: 'removeItem', id: itemId });
      },
      setDistributor: (personId) => {
        setMeta((m) => (m ? { ...m, distributorId: personId } : m));
        return queue({ op: 'setDistributor', personId });
      },
      restoreItem: (item) => {
        if (current.current.items.some((i) => i.id === item.id)) return false;
        dispatch({ type: 'ADD_ITEM', payload: item });
        return queue({ op: 'addItem', item });
      },
      clearItems: () => {
        dispatch({ type: 'CLEAR_ITEMS', payload: null });
        return queue({ op: 'clearItems' });
      },
      refreshRates: (currencies) => {
        if (currencies.length === 0) return false;
        // The server fetches the rates; its numbers show once saved
        reloadAfterSave.current = true;
        return queue({ op: 'refreshRates', currencies });
      },
      setRate: (currency, rate) => {
        if (rate == null) {
          reloadAfterSave.current = true;
        } else {
          for (const item of current.current.items) {
            if (item.original?.currency !== currency) continue;
            dispatch({ type: 'UPDATE_ITEM', payload: toApiItem(atRate(item, rate)) });
          }
        }
        return queue({ op: 'setRate', currency, rate });
      },
    }),
    [dispatch, queue],
  );

  /** Tries a failed save again now, rather than waiting for the automatic retry */
  const retry = useCallback(() => {
    void save();
  }, [save]);

  /** Saves anything queued now, resolving once the server has it (photos need their item saved) */
  const whenSaved = useCallback(async () => {
    const deadline = Date.now() + 20_000;
    void save();
    while (pending.current.length > 0 || inFlight.current) {
      if (Date.now() > deadline) throw new Error('Still saving. Try again in a moment.');
      await new Promise((r) => setTimeout(r, 100));
    }
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

  return { status, meta, setMeta, refreshMeta, actions, retry, whenSaved };
}
