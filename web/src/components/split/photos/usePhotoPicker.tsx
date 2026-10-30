import { useRef } from 'react';
import type { PhotoSource } from '../../../split/photo-places';

/**
 * Hidden file inputs for adding photos: one opens the camera, the other picks one or
 * several from the device's library, and `onAdd` gets what was picked, and from which
 * (a photo just taken was taken here). Render `inputs` once, then call `takePhoto` or
 * `chooseFromLibrary`.
 */
export function usePhotoPicker(onAdd: (files: File[], from: PhotoSource) => void) {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const add = (input: HTMLInputElement, from: PhotoSource) => {
    const files = [...(input.files ?? [])];
    input.value = '';
    if (files.length > 0) onAdd(files, from);
  };
  const inputs = (
    <>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => add(e.target, 'camera')}
      />
      <input
        ref={library}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => add(e.target, 'library')}
      />
    </>
  );
  return {
    inputs,
    takePhoto: () => camera.current?.click(),
    chooseFromLibrary: () => library.current?.click(),
  };
}
