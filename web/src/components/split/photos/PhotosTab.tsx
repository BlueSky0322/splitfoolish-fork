import { ActionIcon, Button, Portal, UnstyledButton } from '@mantine/core';
import {
  Check,
  DownloadSimple,
  Receipt,
  SortAscending,
  SortDescending,
  Trash,
  X,
} from '@phosphor-icons/react';
import type { Attachment } from '@shared/api';
import { useState } from 'react';
import { attachmentUrl } from '../../../api';
import { useIsMobile } from '../../../hooks/useBreakpoints';
import { PHONE_PHOTO_SORTS } from '../../../split/photo-days';
import { photoFileName, usePhotoDownload } from '../../../split/photo-download';
import PhotoViewer, { type ViewerPhoto } from '../../ui/PhotoViewer';
import { useLongPress } from '../../../hooks/useLongPress';
import bar from '../items/ItemSelection.module.css';
import PillMenu from '../PillMenu';
import { useSplitPage } from '../SplitPageContext';
import classes from './PhotosTab.module.css';
import { usePhotoGallery } from './usePhotoGallery';
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
      aria-label={label ? `Photo of ${label}` : 'Photo'}
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

// The split's Photos tab on a phone: the photos on its items, by day, each with the item
// it belongs to. Photos are added on their item. Its menu offers the orders a computer's
// Photos tab does. A long press picks photos, to download or remove them together.
const PhotosTab = ({ pick }: { pick: PhotoSelection }) => {
  const { splitId, meta, photos } = useSplitPage();
  // Phones save each photo as usual; a tablet gets one zip, as a computer does
  const saving = usePhotoDownload(splitId, meta?.name ?? '', { zip: !useIsMobile() });
  const [open, setOpen] = useState<number | null>(null);
  const gallery = usePhotoGallery(pick.selected);
  // shown: the photos in order, what the viewer steps through and All picks
  const { view, setView, all, days, shown, itemById, chosen, confirm } = gallery;
  const sort =
    PHONE_PHOTO_SORTS.find((o) => o.sortKey === view.sortKey && o.sortDir === view.sortDir) ??
    PHONE_PHOTO_SORTS[0];
  const viewer: ViewerPhoto[] = shown.map((photo) => ({
    key: photo.id,
    src: attachmentUrl(splitId, photo.id),
    onRemove: gallery.removerOf(photo),
    fileName: photoFileName(photo),
  }));

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
              disabled={!gallery.canRemoveChosen}
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
        </div>
      )}
      {all.length === 0 && (
        <div className={classes.empty}>
          <span className={classes.emptyIcon}>
            <Receipt size={30} />
          </span>
          <div className={classes.emptyTitle}>No photos yet</div>
          <div className={classes.emptyBody}>
            Add a receipt or photo on its item, and it shows here.
          </div>
        </div>
      )}
      {days.map((day) => (
        <section key={day.key}>
          <h2 className={classes.day}>{day.label}</h2>
          <div className={classes.grid}>
            {day.photos.map((photo) => (
              <PhotoTile
                key={photo.id}
                photo={photo}
                label={photo.itemId ? itemById.get(photo.itemId)?.name : null}
                picking={pick.active}
                picked={pick.selected.has(photo.id)}
                onOpen={() => setOpen(gallery.indexOf.get(photo.id)!)}
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
      {gallery.confirmDialog}
    </div>
  );
};

export default PhotosTab;
