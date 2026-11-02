import { photoPosition } from '../utils/exif';
import type { Position } from '../utils/here';

/**
 * Where each photo was taken, as Android's Photos would say: the position the camera
 * wrote into the photo, read before it's shrunk (which drops it). One that doesn't say
 * (the phone's picker may have taken it out) has none: the phone isn't asked.
 */
export const locatePhotos = (files: File[]): Promise<(Position | null)[]> =>
  Promise.all(files.map(photoPosition));
