import { photoPosition } from '../utils/exif';
import { type Position, currentPosition } from '../utils/here';

/** How photos came to be added: just taken with the camera, or chosen from the device */
export type PhotoSource = 'camera' | 'library';

/**
 * Where each photo was taken, as Android's Photos would say: the position the camera
 * wrote into the photo, or for one just taken without it, where the phone is now (when
 * `live`, as the account's Record my location setting says). A photo chosen from the
 * library without one says nothing (the phone's picker may have taken it out), as it
 * could have been taken anywhere.
 */
export async function locatePhotos(
  files: File[],
  from: PhotoSource,
  live: boolean,
): Promise<(Position | null)[]> {
  const written = await Promise.all(files.map(photoPosition));
  if (from !== 'camera' || !live || written.every((p) => p != null)) return written;
  const here = await currentPosition();
  return written.map((p) => p ?? here);
}
