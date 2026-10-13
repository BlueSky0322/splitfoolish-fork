import { useContext, useEffect, useRef, useState } from 'react';
import { AppContext } from '../context/AppContext/AppContext';

export type SyncStatus = 'loading' | 'saving' | 'saved' | 'error';

const SAVE_DEBOUNCE_MS = 500;

// Each split lives at ?s=<id>. Anyone with the link can view and edit it.
function getOrCreateSplitId(): string {
  const params = new URLSearchParams(window.location.search);
  let id = params.get('s');
  if (!id) {
    id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    params.set('s', id);
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
  }
  return id;
}

export function useRemoteSync() {
  const { state, dispatch } = useContext(AppContext);
  const [status, setStatus] = useState<SyncStatus>('loading');
  const splitId = useRef(getOrCreateSplitId());
  const loaded = useRef(false);
  const lastSaved = useRef<string>('');

  // Load once on mount
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/splits/${splitId.current}`);
        if (cancelled) return;

        if (res.ok) {
          const data = await res.json();
          lastSaved.current = JSON.stringify(data);
          dispatch({ type: 'LOAD_STATE', payload: data });
        } else if (res.status === 404) {
          // New split: seed from old browser-only data, if any
          dispatch({ type: 'LOAD_FROM_LOCALSTORAGE', payload: null });
          dispatch({ type: 'SETTLE', payload: null });
        } else {
          throw new Error(`GET failed: ${res.status}`);
        }

        loaded.current = true;
        setStatus('saved');
      } catch (err) {
        console.error(err);
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  // Debounced save whenever people/items change
  useEffect(() => {
    if (!loaded.current) return;

    const body = JSON.stringify({ people: state.people, items: state.items });
    if (body === lastSaved.current) return;

    setStatus('saving');
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/splits/${splitId.current}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        if (!res.ok) throw new Error(`PUT failed: ${res.status}`);
        lastSaved.current = body;
        setStatus('saved');
      } catch (err) {
        console.error(err);
        setStatus('error');
      }
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [state.people, state.items]);

  return { status, splitId: splitId.current };
}
