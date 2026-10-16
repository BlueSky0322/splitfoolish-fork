import { ActionIcon, Button, Portal, UnstyledButton } from '@mantine/core';
import { Check, DownloadSimple, Trash, X } from '@phosphor-icons/react';
import type { Attachment } from '@shared/api';
import { useMemo, useRef, useState } from 'react';
import { attachmentUrl } from '../../../api';
import { useIsMobile } from '../../../hooks/useBreakpoints';
import { dayKey, dayLabel } from '../../../split/grouping';
import { photoFileName, usePhotoDownload } from '../../../split/photo-download';
import { useSplitState } from '../../../split/SplitStateContext';
import Fab from '../../ui/Fab';
import PhotoViewer, { type ViewerPhoto } from '../../ui/PhotoViewer';
import { useLongPress } from '../items/useItemSelection';
import bar from '../items/ItemSelection.module.css';
import { useSplitPage } from '../SplitPageContext';
import classes from './PhotosTab.module.css';
import QueuedPhotoTile from './QueuedPhotoTile';
import { useConfirmRemovePhotos } from './useConfirmRemovePhotos';
import type { PhotoSelection } from './usePhotoSelection';

/** One photo: a tap opens it, or picks it while picking; a long press starts picking */
function PhotoTile({
  photo,
  label,
  picking,
  picked,
  onOpen,
  onToggle,
}: {
  photo: Attachment;
  label: string | null | undefined;
  picking: boolean;
  picked: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const { splitId } = useSplitPage();
  const { consumeClick, ...press } = useLongPress(onToggle);
  return (
    <UnstyledButton
      {...press}
      className={classes.tile}
      data-picked={picked || undefined}
      onClick={() => {
        if (consumeClick()) return;
        if (picking) onToggle();
        else onOpen();
      }}
      role={picking ? 'checkbox' : undefined}
      aria-checked={picking ? picked : undefined}
      aria-label={label ? `Photo of ${label}` : 'Photo of the split'}
    >
      <img
        src={attachmentUrl(splitId, photo.id)}
        alt=""
        loading="lazy"
        draggable={false}
      />
      {label && <span className={classes.label}>{label}</span>}
      {picking && <span className={classes.check}>{picked && <Check size={14} />}</span>}
    </UnstyledButton>
  );
}

// The split's Photos tab on a phone: every photo, the split's own and each item's
// receipts, by the day it was added, newest first, with the item it belongs to. A long
// press picks photos, to download or remove them together.
const PhotosTab = ({ pick }: { pick: PhotoSelection }) => {
  const { splitId, meta, photos, canRemovePhoto } = useSplitPage();
  // Phones save each photo as usual; a tablet gets one zip, as a computer does
  const saving = usePhotoDownload(splitId, meta?.name ?? '', { zip: !useIsMobile() });
  const { items } = useSplitState().state;
  const [open, setOpen] = useState<number | null>(null);
  const queued = photos.queuedOf(null);

  const all = useMemo(
    () => [...(meta?.attachments ?? [])].sort((a, b) => b.createdAt - a.createdAt),
    [meta?.attachments],
  );
  const nameOf = new Map(items.map((i) => [i.id, i.name]));
  const days: { key: string; label: string; start: number; count: number }[] = [];
  all.forEach((photo, index) => {
    const key = dayKey(photo.createdAt);
    const last = days.at(-1);
    if (last?.key === key) last.count++;
    else days.push({ key, label: dayLabel(photo.createdAt), start: index, count: 1 });
  });
  const { confirm, dialog: confirmDialog } = useConfirmRemovePhotos();
  const viewer: ViewerPhoto[] = all.map((photo) => ({
    key: photo.id,
    src: attachmentUrl(splitId, photo.id),
    onRemove: canRemovePhoto(photo) ? () => confirm(1, () => photos.remove(photo)) : undefined,
    fileName: photoFileName(photo),
  }));
  // Picked photos still there (one removed elsewhere drops out)
  const chosen = all.filter((p) => pick.selected.has(p.id));
  const canRemoveAll = chosen.length > 0 && chosen.every(canRemovePhoto);

  return (
    <div className={classes.tab}>
      {pick.active && (
        // Over the page's header, so outside the tab, which slides
        <Portal>
          <div
            className={bar.mobileBar}
            role="toolbar"
            aria-label="Selected photos"
          >
            <ActionIcon
              variant="subtle"
              color="gray"
              size={44}
              aria-label="Stop selecting"
              onClick={pick.clear}
            >
              <X size={20} />
            </ActionIcon>
            <span className={bar.count}>{chosen.length} selected</span>
            <Button
              variant="subtle"
              size="compact-md"
              onClick={() =>
                chosen.length === all.length ? pick.clear() : pick.pick(all.map((p) => p.id))
              }
            >
              {chosen.length === all.length ? 'None' : 'All'}
            </Button>
            <ActionIcon
              variant="subtle"
              color="gray"
              size={44}
              aria-label={chosen.length === 1 ? 'Download photo' : 'Download photos'}
              loading={saving.busy}
              onClick={() => void saving.download(chosen)}
            >
              <DownloadSimple size={20} />
            </ActionIcon>
            <ActionIcon
              variant="subtle"
              size={44}
              aria-label={chosen.length === 1 ? 'Remove photo' : 'Remove photos'}
              className={bar.danger}
              disabled={!canRemoveAll}
              onClick={() =>
                confirm(chosen.length, () => {
                  void photos.removeMany(chosen);
                  pick.clear();
                })
              }
            >
              <Trash size={20} />
            </ActionIcon>
          </div>
        </Portal>
      )}
      {queued.length > 0 && (
        <div className={classes.grid}>
          {queued.map((photo) => (
            <QueuedPhotoTile
              key={photo.id}
              photo={photo}
              className={classes.tile}
              onRemove={() => photos.removeQueued(photo)}
            />
          ))}
        </div>
      )}
      {all.length === 0 && queued.length === 0 && (
        <p className="sf-muted text-sm text-center py-10">
          No photos yet. Add some of the trip here, or a receipt on its item.
        </p>
      )}
      {days.map((day) => (
        <section key={day.key}>
          <h2 className={classes.day}>{day.label}</h2>
          <div className={classes.grid}>
            {all.slice(day.start, day.start + day.count).map((photo, i) => (
              <PhotoTile
                key={photo.id}
                photo={photo}
                label={photo.itemId ? nameOf.get(photo.itemId) : null}
                picking={pick.active}
                picked={pick.selected.has(photo.id)}
                onOpen={() => setOpen(day.start + i)}
                onToggle={() => pick.toggle(photo.id)}
              />
            ))}
          </div>
        </section>
      ))}
      <PhotoViewer
        photos={viewer}
        index={open}
        onIndexChange={setOpen}
      />
      {confirmDialog}
    </div>
  );
};

export default PhotosTab;

/**
 * The Photos tab's Add photos button. Kept outside the tab itself, which slides as tabs
 * change: a fixed button inside it would slide too, then jump to its corner.
 */
export function AddPhotosFab() {
  const { photos } = useSplitPage();
  const picker = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={picker}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length > 0) void photos.upload(files, null);
        }}
      />
      <Fab
        label="Add photos"
        onClick={() => picker.current?.click()}
      />
    </>
  );
}
