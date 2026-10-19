import { useRef } from 'react';
import { useSplitPage } from '../SplitPageContext';

/**
 * Hidden file inputs that add split photos: one opens the camera, the other picks one
 * or several from the device's library. Render `inputs` once, then call `takePhoto` or
 * `chooseFromLibrary`.
 */
export function usePhotoPicker() {
  const { photos } = useSplitPage();
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const add = (input: HTMLInputElement) => {
    const files = [...(input.files ?? [])];
    input.value = '';
    if (files.length > 0) void photos.upload(files, null);
  };
  const inputs = (
    <>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => add(e.target)}
      />
      <input
        ref={library}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => add(e.target)}
      />
    </>
  );
  return {
    inputs,
    takePhoto: () => camera.current?.click(),
    chooseFromLibrary: () => library.current?.click(),
  };
}
