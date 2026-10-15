import { notifications } from '@mantine/notifications';
import { showError } from './notify';

/** The person closed the share sheet without sharing: nothing to report */
export const isShareCancelled = (err: unknown) =>
  err instanceof DOMException && err.name === 'AbortError';

/** Copies text and says so; the browser can refuse (no permission, page not focused) */
export async function copyText(text: string, done: string) {
  try {
    if (navigator.clipboard == null) throw new Error('No clipboard');
    await navigator.clipboard.writeText(text);
    notifications.show({ message: done });
  } catch (err) {
    showError(err, "Couldn't copy that");
  }
}
