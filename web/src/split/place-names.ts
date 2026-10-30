import { useDebouncedValue } from '@mantine/hooks';
import type { Place } from '@shared/places';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { queryClient } from '../query-client';

// What is at a place, from OpenStreetMap through the Worker (worker/places/names.ts):
// looked up once per spot (about 11 m) while the app is open. And places found by name.

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

/** Wait this long after the last key before searching, so a word is searched once */
const SEARCH_AFTER_MS = 300;
/** A search needs this much to find anything useful */
export const MIN_PLACE_SEARCH = 3;

/**
 * Places called what's typed, as it's typed (komoot's Photon through the Worker,
 * worker/places/search.ts), those near `near` first. Each search is asked once while the
 * app is open; the last answer stays while the next is on its way.
 */
export function usePlaceSearch(text: string, near: { lat: number; lng: number } | null) {
  const [typed] = useDebouncedValue(text.trim().replace(/\s+/g, ' '), SEARCH_AFTER_MS);
  const area = near && { lat: Number(near.lat.toFixed(1)), lng: Number(near.lng.toFixed(1)) };
  const enabled = typed.length >= MIN_PLACE_SEARCH;
  const found = useQuery({
    queryKey: ['place-search', typed.toLowerCase(), area?.lat ?? null, area?.lng ?? null],
    queryFn: async () => (await api.searchPlaces(typed, area)).places,
    enabled,
    staleTime: Infinity,
    retry: false,
    placeholderData: keepPreviousData,
  });
  return {
    places: enabled ? found.data ?? [] : [],
    // Still typing, or asking: not yet "nothing found"
    searching: enabled && (typed !== text.trim().replace(/\s+/g, ' ') || found.isFetching),
    failed: enabled && found.isError,
    searched: enabled && found.isSuccess && !found.isPlaceholderData,
  };
}
