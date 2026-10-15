import { reloadHomeData } from '../home/home-data';
import { flushOfflineChanges } from './pending-creates';

// Sending what was kept on this device while offline (splits made, changes to them):
// once the signed-in account is known, and whenever the connection comes back

/** Once signed in: sends what was kept before the app was last closed */
export const syncAfterSignIn = () =>
  void flushOfflineChanges().then((sent) => (sent > 0 ? reloadHomeData() : undefined));

/** Called once at start: back online, sends what was kept meanwhile */
export function syncWhenOnline() {
  window.addEventListener('online', () => {
    void flushOfflineChanges().then(() => reloadHomeData());
  });
}
