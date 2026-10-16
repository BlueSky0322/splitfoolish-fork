import { useEffect, useMemo } from 'react';

/** Addresses for photos still on this device, freed once they're gone */
export function useBlobUrls(blobs: Blob[]) {
  const urls = useMemo(() => new Map(blobs.map((b) => [b, URL.createObjectURL(b)])), [blobs]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return urls;
}
