import { ActionIcon, Loader, UnstyledButton } from '@mantine/core';
import { Camera, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { attachmentUrl } from '../../../api';
import type { ViewerPhoto } from '../../ui/PhotoViewer';
import PhotoViewer from '../../ui/PhotoViewer';
import classes from './Photos.module.css';
import type { Attachment } from '@shared/api';

interface PhotoStripProps {
  splitId: string;
  /** Photos already saved */
  photos: Attachment[];
  /** Picked but not uploaded yet (a new item's receipts wait until it's added) */
  pending?: File[];
  /** On their way up: shown from this device with a spinner */
  uploading?: File[];
  canRemove: (photo: Attachment) => boolean;
  onAdd: (files: File[]) => void;
  onRemove: (photo: Attachment) => void;
  onRemovePending?: (file: File) => void;
  label?: string;
  /** A wrapping grid of larger tiles, for the split's own photos */
  layout?: 'strip' | 'gallery';
}

/** Addresses for photos still on this device, freed once they're gone */
function useFileUrls(files: File[]) {
  const urls = useMemo(() => new Map(files.map((f) => [f, URL.createObjectURL(f)])), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return urls;
}

function PendingThumb({
  file,
  url,
  onOpen,
  onRemove,
  busy,
}: {
  file: File;
  url: string | undefined;
  onOpen: () => void;
  onRemove?: () => void;
  busy?: boolean;
}) {
  return (
    <div className={classes.thumb}>
      {url && (
        <UnstyledButton
          className={classes.open}
          onClick={onOpen}
          aria-label={`Open ${file.name}`}
        >
          <img
            src={url}
            alt=""
          />
        </UnstyledButton>
      )}
      {busy && (
        <div className={classes.busy}>
          <Loader
            size="xs"
            color="white"
          />
        </div>
      )}
      {onRemove && (
        <ActionIcon
          className={classes.remove}
          size={22}
          radius="xl"
          variant="default"
          aria-label={`Remove ${file.name}`}
          onClick={onRemove}
        >
          <X size={12} />
        </ActionIcon>
      )}
    </div>
  );
}

// A row of photo thumbnails after an "Add photo" tile (or a grid ending in one, for a
// split's photos); tapping a photo opens the viewer
const PhotoStrip = ({
  splitId,
  photos,
  pending = [],
  uploading = [],
  canRemove,
  onAdd,
  onRemove,
  onRemovePending,
  label = 'Add photo',
  layout = 'strip',
}: PhotoStripProps) => {
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const local = useMemo(() => [...pending, ...uploading], [pending, uploading]);
  const urls = useFileUrls(local);

  // Everything shown, in order, for moving between them in the viewer
  const viewer: ViewerPhoto[] = [
    ...photos.map((photo) => ({
      key: photo.id,
      src: attachmentUrl(splitId, photo.id),
      onRemove: canRemove(photo) ? () => onRemove(photo) : undefined,
    })),
    ...pending.map((file, ix) => ({
      key: `pending-${ix}-${file.name}`,
      src: urls.get(file) ?? '',
      onRemove: onRemovePending ? () => onRemovePending(file) : undefined,
    })),
    ...uploading.map((file, ix) => ({
      key: `uploading-${ix}-${file.name}`,
      src: urls.get(file) ?? '',
    })),
  ];

  const addTile = (
    <UnstyledButton
      className={`${classes.thumb} ${classes.add}`}
      onClick={() => input.current?.click()}
    >
      <Camera size={20} />
      <span>{label}</span>
    </UnstyledButton>
  );

  return (
    // A strip is one row that scrolls sideways, with Add first so it's always in reach
    <div className={layout === 'gallery' ? classes.gallery : classes.strip}>
      {layout === 'strip' && addTile}
      {photos.map((photo, ix) => (
        <div
          key={photo.id}
          className={classes.thumb}
        >
          <UnstyledButton
            className={classes.open}
            onClick={() => setOpen(ix)}
            aria-label={`Open photo ${ix + 1}`}
          >
            <img
              src={attachmentUrl(splitId, photo.id)}
              alt=""
              loading="lazy"
            />
          </UnstyledButton>
          {canRemove(photo) && (
            <ActionIcon
              className={classes.remove}
              size={22}
              radius="xl"
              variant="default"
              aria-label={`Remove photo ${ix + 1}`}
              onClick={() => onRemove(photo)}
            >
              <X size={12} />
            </ActionIcon>
          )}
        </div>
      ))}
      {pending.map((file, ix) => (
        <PendingThumb
          key={`${file.name}-${ix}`}
          file={file}
          url={urls.get(file)}
          onOpen={() => setOpen(photos.length + ix)}
          onRemove={onRemovePending ? () => onRemovePending(file) : undefined}
        />
      ))}
      {uploading.map((file, ix) => (
        <PendingThumb
          key={`uploading-${file.name}-${ix}`}
          file={file}
          url={urls.get(file)}
          onOpen={() => setOpen(photos.length + pending.length + ix)}
          busy
        />
      ))}
      {layout === 'gallery' && addTile}
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length > 0) onAdd(files);
        }}
      />
      <PhotoViewer
        photos={viewer}
        index={open}
        onIndexChange={setOpen}
      />
    </div>
  );
};

export default PhotoStrip;
