import { ActionIcon, Loader, UnstyledButton } from '@mantine/core';
import { Camera, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { Attachment, photoUrl } from '../../api';
import classes from './Photos.module.css';

interface PhotoStripProps {
  splitId: string;
  /** Photos already saved */
  photos: Attachment[];
  /** Picked but not uploaded yet (a new item's receipts wait until it's added) */
  pending?: File[];
  uploading?: number;
  canRemove: (photo: Attachment) => boolean;
  onAdd: (files: File[]) => void;
  onRemove: (photo: Attachment) => void;
  onRemovePending?: (file: File) => void;
  label?: string;
  /** A wrapping grid of larger tiles, for the split's own photos */
  layout?: 'strip' | 'gallery';
}

function PendingThumb({ file, onRemove }: { file: File; onRemove?: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <div className={classes.thumb}>
      {url && (
        <img
          src={url}
          alt={file.name}
        />
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

// A row of photo thumbnails with an "Add photo" tile; tapping a photo opens it full size
const PhotoStrip = ({
  splitId,
  photos,
  pending = [],
  uploading = 0,
  canRemove,
  onAdd,
  onRemove,
  onRemovePending,
  label = 'Add photo',
  layout = 'strip',
}: PhotoStripProps) => {
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className={layout === 'gallery' ? classes.gallery : classes.strip}>
      {photos.map((photo, ix) => (
        <div
          key={photo.id}
          className={classes.thumb}
        >
          <a
            href={photoUrl(splitId, photo.id)}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open photo ${ix + 1}`}
          >
            <img
              src={photoUrl(splitId, photo.id)}
              alt=""
              loading="lazy"
            />
          </a>
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
          onRemove={onRemovePending ? () => onRemovePending(file) : undefined}
        />
      ))}
      {Array.from({ length: uploading }, (_, ix) => (
        <div
          key={`uploading-${ix}`}
          className={`${classes.thumb} ${classes.placeholder}`}
        >
          <Loader size="xs" />
        </div>
      ))}
      <UnstyledButton
        className={`${classes.thumb} ${classes.add}`}
        onClick={() => input.current?.click()}
      >
        <Camera size={20} />
        <span>{label}</span>
      </UnstyledButton>
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
    </div>
  );
};

export default PhotoStrip;
