// Where the phone is now, for a new item, a photo just taken or "Use my current location".
// The browser asks the person the first time; refused, unavailable or too slow, there's no
// position.

/** How long to wait for a fix before going without */
const WAIT_MS = 10_000;
/** A fix this recent is as good as a new one */
const RECENT_MS = 60_000;

export interface Position {
  lat: number;
  lng: number;
}

/** The phone's position, or null when the browser can't or won't say */
export function currentPosition(): Promise<Position | null> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: WAIT_MS, maximumAge: RECENT_MS },
    ),
  );
}
