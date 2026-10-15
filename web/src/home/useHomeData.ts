import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { HOME_KEY, HomeData, fetchHome, showSavedCopy, toHomeData } from './home-data';

// My splits and pending invites for the screens that show them (see home-data.ts)

/** The same data without asking for a fresh copy, for screens that only read it */
export function useHomeDataSnapshot(): HomeData {
  const { data, isError } = useQuery({ queryKey: HOME_KEY, queryFn: fetchHome, enabled: false });
  return toHomeData(data, isError);
}

export function useHomeData(): HomeData {
  useEffect(showSavedCopy, []);
  const { data, isError } = useQuery({ queryKey: HOME_KEY, queryFn: fetchHome });
  return toHomeData(data, isError);
}
