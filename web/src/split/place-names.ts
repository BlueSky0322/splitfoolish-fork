import type { Place } from '@shared/places';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { queryClient } from '../query-client';

// What is at a place, from OpenStreetMap through the Worker (worker/places/names.ts):
// looked up once per spot (about 11 m) while the app is open

const placeNameQuery = (lat: number, lng: number) => ({
  queryKey: ['place-name', lat.toFixed(4), lng.toFixed(4)],
  queryFn: async () => (await api.placeName(lat, lng)).name,
  staleTime: Infinity,
  retry: 1,
});

/**
 * A place's name: the one it was saved with, else OpenStreetMap's for showing it (a
 * place saved before names, or a photo's); null until it's known, or offline
 */
export function usePlaceName(place: Place | null | undefined) {
  const looked = useQuery({
    ...placeNameQuery(place?.lat ?? 0, place?.lng ?? 0),
    enabled: place != null && place.name == null,
  });
  return place?.name ?? looked.data ?? null;
}

/** The name for a place just set, to save with it; null when there's none or no answer */
export const lookUpPlaceName = (lat: number, lng: number) =>
  queryClient.fetchQuery(placeNameQuery(lat, lng)).catch(() => null);
