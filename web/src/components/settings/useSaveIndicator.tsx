import { Check } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import classes from './SettingsLayout.module.css';

const SAVED_FOR_MS = 2000;

/** "Saving" while changes are on their way, then "Saved" for a moment */
export function useSaveIndicator() {
  const [pending, setPending] = useState(0);
  const [justSaved, setJustSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const track = async <T,>(work: Promise<T>) => {
    clearTimeout(timer.current);
    setJustSaved(false);
    setPending((n) => n + 1);
    try {
      return await work;
    } finally {
      setPending((n) => n - 1);
      setJustSaved(true);
      timer.current = setTimeout(() => setJustSaved(false), SAVED_FOR_MS);
    }
  };

  const note = (
    <span
      className={classes.saved}
      data-visible={pending > 0 || justSaved || undefined}
      aria-live="polite"
    >
      {pending > 0 ? (
        'Saving'
      ) : justSaved ? (
        <>
          <Check size={14} /> Saved
        </>
      ) : null}
    </span>
  );

  return { track, note };
}

export type Track = <T>(work: Promise<T>) => Promise<T>;
