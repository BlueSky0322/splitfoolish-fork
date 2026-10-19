import { ActionIcon, Button, Portal, UnstyledButton } from '@mantine/core';
import {
  Camera,
  CameraPlus,
  Check,
  DownloadSimple,
  FunnelSimple,
  Images,
  SortAscending,
  SortDescending,
  Trash,
  X,
} from '@phosphor-icons/react';
import type { Attachment } from '@shared/api';
import { useMemo, useState } from 'react';
import { attachmentUrl } from '../../../api';
import { useIsMobile } from '../../../hooks/useBreakpoints';
import {
  DEFAULT_PHOTO_VIEW,
  PHONE_PHOTO_SORTS,
  PHOTO_FILTERS,
  type PhotoFilter,
  type PhotoView,
  photoCounts,
  photoDays,
} from '../../../split/photo-days';
import { photoFileName, usePhotoDownload } from '../../../split/photo-download';
import { useSplitState } from '../../../split/SplitStateContext';
import Fab from '../../ui/Fab';
import PhotoViewer, { type ViewerPhoto } from '../../ui/PhotoViewer';
import { useLongPress } from '../items/useItemSelection';
import bar from '../items/ItemSelection.module.css';
import PillMenu from '../PillMenu';
import { useSplitPage } from '../SplitPageContext';
import classes from './PhotosTab.module.css';
import QueuedPhotoTile from './QueuedPhotoTile';
import { useConfirmRemovePhotos } from './useConfirmRemovePhotos';
import type { PhotoSelection } from './usePhotoSelection';
import { usePhotoPicker } from './usePhotoPicker';
import AddPhotosSheet from './AddPhotosSheet';

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
// receipts, by day, with the item it belongs to. Its menus offer the orders and kinds a
// computer's Photos tab does. A long press picks photos, to download or remove
// them together.
const PhotosTab = ({ pick }: { pick: PhotoSelection }) => {
  const { splitId, meta, photos, canRemovePhoto } = useSplitPage();
  // Phones save each photo as usual; a tablet gets one zip, as a computer does
  const saving = usePhotoDownload(splitId, meta?.name ?? '', { zip: !useIsMobile() });
  const { items } = useSplitState().state;
  const [open, setOpen] = useState<number | null>(null);
  const [view, setView] = useState<PhotoView>(DEFAULT_PHOTO_VIEW);
  const queued = photos.queuedOf(null);
  const picker = usePhotoPicker((files) => void photos.upload(files, null));

  const all = useMemo(() => meta?.attachments ?? [], [meta?.attachments]);
  const days = useMemo(
    () => photoDays(all, new Map(items.map((i) => [i.id, i.createdAt])), view),
    [all, items, view],
  );
  // The photos shown, in order: what the viewer steps through and All picks
  const shown = days.flatMap((d) => d.photos);
  // Where each day's photos start among them
  const startOf = new Map<string, number>();
  let start = 0;
  for (const day of days) {
    startOf.set(day.key, start);
    start += day.photos.length;
  }
  const counts = photoCounts(all);
  const sort =
    PHONE_PHOTO_SORTS.find((o) => o.sortKey === view.sortKey && o.sortDir === view.sortDir) ??
    PHONE_PHOTO_SORTS[0];
  const filter = PHOTO_FILTERS.find((f) => f.filter === view.filter) ?? PHOTO_FILTERS[0];
  const nameOf = new Map(items.map((i) => [i.id, i.name]));
  const { confirm, dialog: confirmDialog } = useConfirmRemovePhotos();
  const viewer: ViewerPhoto[] = shown.map((photo) => ({
    key: photo.id,
    src: attachmentUrl(splitId, photo.id),
    onRemove: canRemovePhoto(photo) ? () => confirm(1, () => photos.remove(photo)) : undefined,
    fileName: photoFileName(photo),
  }));
  // Picked photos still there (one removed elsewhere drops out)
  const chosen = shown.filter((p) => pick.selected.has(p.id));
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
                chosen.length === shown.length ? pick.clear() : pick.pick(shown.map((p) => p.id))
              }
            >
              {chosen.length === shown.length ? 'None' : 'All'}
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
      {all.length > 0 && !pick.active && (
        <div className={classes.toolbar}>
          <PillMenu
            title="Sort by"
            label={`Sort photos: ${sort.label}`}
            icon={
              sort.sortDir === 'asc' ? <SortAscending size={14} /> : <SortDescending size={14} />
            }
            options={PHONE_PHOTO_SORTS.map((o) => ({
              key: `${o.sortKey} ${o.sortDir}`,
              label: o.label,
            }))}
            value={`${sort.sortKey} ${sort.sortDir}`}
            onChange={(key) => {
              const o = PHONE_PHOTO_SORTS.find((s) => `${s.sortKey} ${s.sortDir}` === key)!;
              setView((v) => ({ ...v, sortKey: o.sortKey, sortDir: o.sortDir }));
            }}
          />
          <PillMenu
            title="Show"
            label={`Show: ${filter.label}, ${counts[filter.filter]}`}
            icon={<FunnelSimple size={14} />}
            options={PHOTO_FILTERS.map((f) => ({
              key: f.filter,
              label: f.label,
              count: counts[f.filter],
            }))}
            value={view.filter}
            onChange={(key) => setView((v) => ({ ...v, filter: key as PhotoFilter }))}
          />
        </div>
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
        <div className={classes.empty}>
          {picker.inputs}
          <span className={classes.emptyIcon}>
            <CameraPlus size={30} />
          </span>
          <div className={classes.emptyTitle}>Add photos</div>
          <div className={classes.emptyBody}>
            Photos for the whole split. Receipts for one item go on that item.
          </div>
          <div className={classes.emptyActions}>
            <Button
              leftSection={<Camera size={18} />}
              onClick={picker.takePhoto}
            >
              Take photo
            </Button>
            <Button
              variant="default"
              leftSection={<Images size={18} />}
              onClick={picker.chooseFromLibrary}
            >
              Choose from library
            </Button>
          </div>
        </div>
      )}
      {all.length > 0 && shown.length === 0 && queued.length === 0 && (
        <p className="sf-muted text-sm text-center py-10">
          {view.filter === 'receipts'
            ? 'No receipts yet. Add one on its item.'
            : 'No photos of the split yet. Add some here.'}
        </p>
      )}
      {days.map((day) => (
        <section key={day.key}>
          <h2 className={classes.day}>{day.label}</h2>
          <div className={classes.grid}>
            {day.photos.map((photo, i) => (
              <PhotoTile
                key={photo.id}
                photo={photo}
                label={photo.itemId ? nameOf.get(photo.itemId) : null}
                picking={pick.active}
                picked={pick.selected.has(photo.id)}
                onOpen={() => setOpen(startOf.get(day.key)! + i)}
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
 * The Photos tab's Add photos button, once the split has photos (before, the tab offers
 * the same choices itself). It opens a sheet: take a photo, or choose from the library.
 * Kept outside the tab itself, which slides as tabs change: a fixed button inside it
 * would slide too, then jump to its corner.
 */
export function AddPhotosFab() {
  const { meta, photos } = useSplitPage();
  const picker = usePhotoPicker((files) => void photos.upload(files, null));
  const [open, setOpen] = useState(false);
  if ((meta?.attachments.length ?? 0) === 0 && photos.queuedOf(null).length === 0) return null;
  return (
    <>
      {picker.inputs}
      <Fab
        label="Add photos"
        onClick={() => setOpen(true)}
      />
      <AddPhotosSheet
        opened={open}
        onClose={() => setOpen(false)}
        onTakePhoto={picker.takePhoto}
        onChooseFromLibrary={picker.chooseFromLibrary}
      />
    </>
  );
}
