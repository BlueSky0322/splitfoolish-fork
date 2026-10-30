import type { PhotoSource } from '../../../split/photo-places';
import { ActionIcon, Loader, UnstyledButton } from '@mantine/core';
import { Camera, CloudSlash, X } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { attachmentUrl } from '../../../api';
import { useIsDesktop } from '../../../hooks/useBreakpoints';
import type { QueuedPhoto } from '../../../split/usePhotos';
import type { ViewerPhoto } from '../../ui/PhotoViewer';
import PhotoViewer from '../../ui/PhotoViewer';
import classes from './Photos.module.css';
import { useConfirmRemovePhotos } from './useConfirmRemovePhotos';
import { useBlobUrls } from './blob-urls';
import AddPhotosSheet from './AddPhotosSheet';
import { usePhotoPicker } from './usePhotoPicker';
import type { Attachment } from '@shared/api';

interface PhotoStripProps {
  splitId: string;
  /** Photos already saved */
  photos: Attachment[];
  /** Picked but not uploaded yet (a new item's receipts wait until it's added) */
  pending?: File[];
  /**
   * Still to upload, shown from this device: with a spinner on their way up, or marked
   * as waiting (offline, say) and removable
   */
  queued?: QueuedPhoto[];
  canRemove: (photo: Attachment) => boolean;
  onAdd: (files: File[], from: PhotoSource) => void;
  onRemove: (photo: Attachment) => void;
  onRemovePending?: (file: File) => void;
  onRemoveQueued?: (photo: QueuedPhoto) => void;
  label?: string;
}

function PendingThumb({
  name,
  url,
  onOpen,
  onRemove,
  busy,
  waiting,
}: {
  name: string;
  url: string | undefined;
  onOpen: () => void;
  onRemove?: () => void;
  busy?: boolean;
  /** Kept on this device until it can be uploaded */
  waiting?: boolean;
}) {
  return (
    <div className={classes.thumb}>
      {url && (
        <UnstyledButton
          className={classes.open}
          onClick={onOpen}
          aria-label={`Open ${name}`}
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
      {waiting && (
        <span
          className={classes.waiting}
          title="Waiting to upload"
        >
          <CloudSlash size={12} />
          <span className="sr-only">Waiting to upload</span>
        </span>
      )}
      {onRemove && (
        <ActionIcon
          className={classes.remove}
          size={22}
          radius="xl"
          variant="default"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
        >
          <X size={12} />
        </ActionIcon>
      )}
    </div>
  );
}

// A row of photo thumbnails after an "Add photo" tile; tapping a photo opens the viewer.
// On a computer the tile opens the file chooser; on phones and tablets it offers the
// camera or the library, as the Photos tab does.
const PhotoStrip = ({
  splitId,
  photos,
  pending = [],
  queued = [],
  canRemove,
  onAdd,
  onRemove,
  onRemovePending,
  onRemoveQueued,
  label = 'Add photo',
}: PhotoStripProps) => {
  const picker = usePhotoPicker(onAdd);
  const isDesktop = useIsDesktop();
  const [choosing, setChoosing] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  // Saved photos go for everyone, so removing one asks first; one not sent yet doesn't
  const { confirm, dialog: confirmDialog } = useConfirmRemovePhotos();
  const removeSaved = (photo: Attachment) => confirm(1, () => onRemove(photo));
  const local = useMemo(
    () => [...pending, ...queued.flatMap((p) => (p.image ? [p.image] : []))],
    [pending, queued],
  );
  const urls = useBlobUrls(local);
  const removeQueued = (photo: QueuedPhoto) =>
    !photo.busy && onRemoveQueued ? () => onRemoveQueued(photo) : undefined;

  // Everything shown, in order, for moving between them in the viewer
  const viewer: ViewerPhoto[] = [
    ...photos.map((photo) => ({
      key: photo.id,
      src: attachmentUrl(splitId, photo.id),
      onRemove: canRemove(photo) ? () => removeSaved(photo) : undefined,
    })),
    ...pending.map((file, ix) => ({
      key: `pending-${ix}-${file.name}`,
      src: urls.get(file) ?? '',
      onRemove: onRemovePending ? () => onRemovePending(file) : undefined,
    })),
    ...queued.map((photo) => ({
      key: `queued-${photo.id}`,
      src: (photo.image && urls.get(photo.image)) ?? '',
      onRemove: removeQueued(photo),
    })),
  ];

  const addTile = (
    <UnstyledButton
      className={`${classes.thumb} ${classes.add}`}
      onClick={() => (isDesktop ? picker.chooseFromLibrary() : setChoosing(true))}
    >
      <Camera size={20} />
      <span>{label}</span>
    </UnstyledButton>
  );

  const waiting = queued.filter((p) => !p.busy).length;

  return (
    <>
      {/* One row that scrolls sideways, with Add first so it's always in reach */}
      <div className={classes.strip}>
        {addTile}
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
                onClick={() => removeSaved(photo)}
              >
                <X size={12} />
              </ActionIcon>
            )}
          </div>
        ))}
        {pending.map((file, ix) => (
          <PendingThumb
            key={`${file.name}-${ix}`}
            name={file.name}
            url={urls.get(file)}
            onOpen={() => setOpen(photos.length + ix)}
            onRemove={onRemovePending ? () => onRemovePending(file) : undefined}
          />
        ))}
        {queued.map((photo, ix) => (
          <PendingThumb
            key={`queued-${photo.id}`}
            name={photo.name}
            url={photo.image ? urls.get(photo.image) : undefined}
            onOpen={() => setOpen(photos.length + pending.length + ix)}
            onRemove={removeQueued(photo)}
            busy={photo.busy}
            waiting={!photo.busy}
          />
        ))}
        {picker.inputs}
        <PhotoViewer
          photos={viewer}
          index={open}
          onIndexChange={setOpen}
        />
        {confirmDialog}
      </div>
      <AddPhotosSheet
        opened={choosing}
        title={label}
        onClose={() => setChoosing(false)}
        onTakePhoto={picker.takePhoto}
        onChooseFromLibrary={picker.chooseFromLibrary}
      />
      {waiting > 0 && (
        <p className="sf-muted text-xs mt-1">
          {waiting === 1
            ? '1 photo is kept on this device until it can be uploaded'
            : `${waiting} photos are kept on this device until they can be uploaded`}
        </p>
      )}
    </>
  );
};

export default PhotoStrip;
