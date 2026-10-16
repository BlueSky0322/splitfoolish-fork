import { isShareCancelled } from './share';

// Handing a file the app made to the person: the share sheet where the device has one
// for files (phones), otherwise a download.

/** Saves `href` (a link or an object URL) to the device as `name` */
export function saveFile(href: string, name: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
}

/** Saves a file the app made, through a link that lasts long enough to start saving it */
export function saveBlob(file: File) {
  const url = URL.createObjectURL(file);
  saveFile(url, file.name);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** What became of a file: shared, saved, or the share sheet closed without sharing */
export type Delivery = 'shared' | 'saved' | 'cancelled';

/**
 * Opens the share sheet with the file where the device can share files, or saves it
 * where it can't. Closing the share sheet does nothing more; if sharing fails any other
 * way, the file is saved instead. `save` replaces how it's saved.
 */
export async function deliverFile(
  file: File,
  { title, save = () => saveBlob(file) }: { title: string; save?: () => void },
): Promise<Delivery> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (err) {
      if (isShareCancelled(err)) return 'cancelled';
    }
  }
  save();
  return 'saved';
}

/**
 * A file name from a split's name, in lower case, keeping letters and digits in any
 * script: "Japan trip" is "japan-trip", "東京旅行" stays as it is, and a name with
 * nothing to keep is "split"
 */
export const fileSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'split';
