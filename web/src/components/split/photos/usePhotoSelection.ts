import { useCallback, useMemo, useState } from 'react';

/**
 * Photos picked on the phone's Photos tab. Picking starts with a long press and ends
 * once nothing is picked, as with items.
 */
export function usePhotoSelection() {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback(
    (id: string) =>
      setSelected((s) => {
        const next = new Set(s);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );
  const pick = useCallback((ids: string[]) => setSelected(new Set(ids)), []);
  const clear = useCallback(() => setSelected(new Set()), []);
  return useMemo(
    () => ({ selected, active: selected.size > 0, toggle, pick, clear }),
    [selected, toggle, pick, clear],
  );
}

export type PhotoSelection = ReturnType<typeof usePhotoSelection>;
