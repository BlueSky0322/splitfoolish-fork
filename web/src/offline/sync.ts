import { flushOfflineChanges } from './pending-creates';

// Sending what was kept on this device while offline (splits made, changes to them):
// once the signed-in account is known, and whenever the connection comes back. Then
// `sent` runs, for what's shown to catch up.

/** Once signed in: sends what was kept before the app was last closed */
export const syncAfterSignIn = (sent: () => void) =>
  void flushOfflineChanges().then((count) => (count > 0 ? sent() : undefined));

/** Called once at start: back online, sends what was kept meanwhile */
export function syncWhenOnline(sent: () => void) {
  window.addEventListener('online', () => void flushOfflineChanges().then(sent));
}
