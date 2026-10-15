import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { MySplits } from './my-splits';
import { MY_SPLITS_KEY, fetchMySplits, showSavedCopy, toMySplits } from './my-splits';

// My splits and pending invites for the screens that show them (see my-splits.ts)

/** The same data without asking for a fresh copy, for screens that only read it */
export function useMySplitsSnapshot(): MySplits {
  const { data, isError } = useQuery({
    queryKey: MY_SPLITS_KEY,
    queryFn: fetchMySplits,
    enabled: false,
  });
  return toMySplits(data, isError);
}

export function useMySplits(): MySplits {
  useEffect(showSavedCopy, []);
  const { data, isError } = useQuery({ queryKey: MY_SPLITS_KEY, queryFn: fetchMySplits });
  return toMySplits(data, isError);
}
