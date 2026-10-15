import { useEffect, useRef, useState } from 'react';
import { navigate } from '../../hooks/useRoute';
import { isCurrency } from '@shared/rates';

export interface Prefill {
  amount: string;
  currency: string;
}

/** Convert's "Add as item" arrives as ?add=1&amount=…&from=… */
function readPrefill(): Prefill | null {
  const params = new URLSearchParams(window.location.search);
  const amount = params.get('amount');
  const from = params.get('from');
  return params.has('add') && amount && isCurrency(from) ? { amount, currency: from } : null;
}

/**
 * Arriving from Convert's "Add as item": once the split has loaded, the address is
 * tidied and Add item opens with that amount and currency (if there's anyone to split
 * it with)
 */
export function useConvertPrefill(
  splitId: string,
  loaded: boolean,
  hasPeople: boolean,
  openAdd: (prefill: Prefill) => void,
) {
  const [prefill] = useState(readPrefill);
  const handled = useRef(false);
  useEffect(() => {
    if (prefill == null || !loaded || handled.current) return;
    handled.current = true;
    navigate(`?s=${splitId}`, { replace: true });
    if (hasPeople) openAdd(prefill);
  }, [prefill, loaded, hasPeople, splitId, openAdd]);
}
