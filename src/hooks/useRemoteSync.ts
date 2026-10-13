import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ApiError, SplitDetail, api } from '../api';
import { AppContext } from '../context/AppContext/AppContext';

export type SyncStatus = 'loading' | 'saving' | 'saved' | 'error' | 'notfound';

const SAVE_DEBOUNCE_MS = 500;

export type SplitMeta = Omit<SplitDetail, 'people' | 'items'>;

export function useRemoteSync(splitId: string) {
  const { state, dispatch } = useContext(AppContext);
  const [status, setStatus] = useState<SyncStatus>('loading');
  const [meta, setMeta] = useState<SplitMeta | null>(null);
  const loaded = useRef(false);
  const lastSaved = useRef<string>('');

  const load = useCallback(async () => {
    const { people, items, ...rest } = await api.getSplit(splitId);
    const data = { people, items };
    lastSaved.current = JSON.stringify(data);
    setMeta(rest);
    return data;
  }, [splitId]);

  // Load whenever the split changes, clearing the previous split's data first
  useEffect(() => {
    let cancelled = false;
    loaded.current = false;
    setStatus('loading');
    setMeta(null);
    dispatch({ type: 'LOAD_STATE', payload: { people: [], items: [] } });

    (async () => {
      try {
        const data = await load();
        if (cancelled) return;
        dispatch({ type: 'LOAD_STATE', payload: data });
        loaded.current = true;
        setStatus('saved');
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setStatus(err instanceof ApiError && err.status === 404 ? 'notfound' : 'error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [load, dispatch]);

  // Debounced save whenever people/items change
  useEffect(() => {
    if (!loaded.current) return;

    const data = { people: state.people, items: state.items };
    const body = JSON.stringify(data);
    if (body === lastSaved.current) return;

    setStatus('saving');
    const timer = setTimeout(async () => {
      try {
        await api.saveSplit(splitId, data);
        lastSaved.current = body;
        setStatus('saved');
      } catch (err) {
        console.error(err);
        setStatus('error');
      }
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [state.people, state.items, splitId]);

  // Refresh members and invite link after sharing changes, without touching people/items
  const refreshMeta = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { people, items, ...rest } = await api.getSplit(splitId);
    setMeta(rest);
  }, [splitId]);

  return { status, meta, refreshMeta };
}
