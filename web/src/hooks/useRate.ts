import { useQuery } from '@tanstack/react-query';
import { DEFAULT_SETTINGS } from '../../../shared/api';
import { api } from '../api';
import { useProfile } from '../profile/ProfileContext';
import { queryClient } from '../query-client';

/** A rate this recent is reused rather than fetched again */
const RATE_FRESH_MS = 5 * 60 * 1000;

/**
 * Today's rate from one currency into another, shared by everything that shows one.
 * The server picks the source from Settings, so a different source is a different rate.
 */
export function useRate(from: string, to: string, { enabled = true } = {}) {
  const source = useProfile().profile?.settings.ratePreference ?? DEFAULT_SETTINGS.ratePreference;
  const key = ['rate', from, to, source];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.getRate(from, to),
    enabled: enabled && from !== to,
    staleTime: RATE_FRESH_MS,
    retry: 1,
  });
  /** Fetches a recent rate now, in place of the one shown */
  const refresh = async () => {
    queryClient.setQueryData(key, await api.getRate(from, to, { fresh: true }));
  };
  return { ...query, refresh };
}
