import { Button, Menu, Tooltip, UnstyledButton } from '@mantine/core';
import {
  CaretDown,
  Check,
  CheckSquare,
  DownloadSimple,
  Receipt,
  SortAscending,
  SortDescending,
  Trash,
  X,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { attachmentUrl } from '../../../api';
import type { PhotoSortDir, PhotoSortKey } from '../../../split/photo-days';
import { usePhotoDownload } from '../../../split/photo-download';
import PhotoViewer, { type ViewerPhoto } from '../../ui/PhotoViewer';
import UserAvatar from '../../common/UserAvatar';
import { useSplitPage } from '../SplitPageContext';
import classes from './DesktopPhotos.module.css';
import { timeLabel, useAddedBy } from './added-by';
import PhotoDetails from './PhotoDetails';
import { usePhotoGallery } from './usePhotoGallery';

/** Every row of photos is this tall; each photo is as wide as its shape makes it */
const ROW_PX = 150;
/** A photo stretches to fill its row by at most this much */
const MAX_STRETCH = 1.6;

const SORT_LABELS: Record<PhotoSortKey, string> = { added: 'Date added', item: 'Item date' };
const DIRECTION_LABELS: Record<PhotoSortDir, string> = {
  desc: 'Newest first',
  asc: 'Oldest first',
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The split's Photos tab on a computer: the photos on its items, by day in rows that keep
// each photo's shape. Choose the order, and select some to download or remove. Photos
// are added on their item.
const DesktopPhotos = () => {
  const { splitId, meta, photos, openDialog } = useSplitPage();
  const addedBy = useAddedBy();
  const [open, setOpen] = useState<number | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Several photos are saved as one zip
  const saving = usePhotoDownload(splitId, meta?.name ?? '', { zip: true });
  // Width over height of each photo, once it has loaded
  const [shapes, setShapes] = useState<Map<string, number>>(new Map());

  const gallery = usePhotoGallery(selected);
  const { view, setView, all, days, shown, itemById, chosen, confirm } = gallery;
  const empty = all.length === 0;

  const toggle = (ids: string[], on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const viewer: ViewerPhoto[] = shown.map((photo) => {
    const onRemove = gallery.removerOf(photo);
    const item = photo.itemId ? itemById.get(photo.itemId) ?? null : null;
    return {
      key: photo.id,
      src: attachmentUrl(splitId, photo.id),
      onRemove,
      details: (
        <PhotoDetails
          photo={photo}
          item={item}
          onRemove={onRemove}
          onOpenItem={(it) => {
            setOpen(null);
            openDialog({ kind: 'edit', item: it });
          }}
        />
      ),
    };
  });

  return (
    <div className={classes.tab}>
      {selecting ? (
        <div
          className={classes.selectionBar}
          role="toolbar"
          aria-label="Selected photos"
        >
          <UnstyledButton
            className={classes.barClose}
            onClick={stopSelecting}
            aria-label="Stop selecting"
          >
            <X size={16} />
          </UnstyledButton>
          <span className={classes.selectedCount}>
            {chosen.length > 0 ? `${chosen.length} selected` : 'Select photos'}
          </span>
          <span className={classes.spacer} />
          <Button
            variant="subtle"
            color="gray"
            size="xs"
            leftSection={<DownloadSimple size={14} />}
            onClick={() => void saving.download(chosen)}
            disabled={chosen.length === 0}
            loading={saving.busy}
          >
            {chosen.length > 1 ? 'Download zip' : 'Download'}
          </Button>
          <Tooltip
            label="You can only remove photos you added"
            disabled={gallery.canRemoveChosen || chosen.length === 0}
          >
            <Button
              variant="default"
              size="xs"
              className="sf-danger-outline"
              leftSection={<Trash size={14} />}
              disabled={!gallery.canRemoveChosen}
              onClick={() =>
                confirm(chosen.length, () => {
                  void photos.removeMany(chosen);
                  stopSelecting();
                })
              }
            >
              Remove
            </Button>
          </Tooltip>
        </div>
      ) : empty ? null : (
        <div className={classes.toolbar}>
          <Menu
            position="bottom-start"
            withinPortal
          >
            <Menu.Target>
              <Button
                variant="subtle"
                color="gray"
                leftSection={
                  view.sortDir === 'asc' ? (
                    <SortAscending size={16} />
                  ) : (
                    <SortDescending size={16} />
                  )
                }
                rightSection={<CaretDown size={12} />}
                aria-label={`Sort photos: ${SORT_LABELS[view.sortKey]}, ${DIRECTION_LABELS[view.sortDir]}`}
              >
                {DIRECTION_LABELS[view.sortDir]}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Sort by</Menu.Label>
              {(Object.keys(SORT_LABELS) as PhotoSortKey[]).map((key) => (
                <Menu.Item
                  key={key}
                  onClick={() => setView((v) => ({ ...v, sortKey: key }))}
                  color={key === view.sortKey ? 'accent' : undefined}
                  rightSection={key === view.sortKey ? <Check size={14} /> : null}
                >
                  {SORT_LABELS[key]}
                </Menu.Item>
              ))}
              <Menu.Divider />
              {(['desc', 'asc'] as PhotoSortDir[]).map((dir) => (
                <Menu.Item
                  key={dir}
                  leftSection={
                    dir === 'asc' ? <SortAscending size={14} /> : <SortDescending size={14} />
                  }
                  onClick={() => setView((v) => ({ ...v, sortDir: dir }))}
                  color={dir === view.sortDir ? 'accent' : undefined}
                  rightSection={dir === view.sortDir ? <Check size={14} /> : null}
                >
                  {DIRECTION_LABELS[dir]}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
          <span className={classes.spacer} />
          {shown.length > 0 && (
            <Button
              variant="default"
              size="xs"
              leftSection={<CheckSquare size={14} />}
              onClick={() => setSelecting(true)}
            >
              Select
            </Button>
          )}
        </div>
      )}

      {empty && (
        <div className={classes.noneShown}>
          <span className={classes.noneIcon}>
            <Receipt size={22} />
          </span>
          <div className={classes.emptyTitle}>No photos yet</div>
          <div className={classes.emptyBody}>
            Add a receipt or photo on its item, and it shows here.
          </div>
        </div>
      )}

      {days.map((day) => {
        const ids = day.photos.map((p) => p.id);
        const allPicked = ids.every((id) => selected.has(id));
        return (
          <section
            key={day.key}
            aria-label={day.label}
          >
            <h2 className={classes.day}>
              {day.label}
              <span className={classes.dayCount}>{plural(day.photos.length, 'photo')}</span>
              {selecting && (
                <UnstyledButton
                  className={classes.selectDay}
                  onClick={() => toggle(ids, !allPicked)}
                >
                  {allPicked ? 'Clear day' : 'Select day'}
                </UnstyledButton>
              )}
            </h2>
            <div className={classes.row}>
              {day.photos.map((photo) => {
                const ratio = shapes.get(photo.id) ?? 1;
                const item = photo.itemId ? itemById.get(photo.itemId) : null;
                const who = addedBy(photo.uploadedBy);
                const picked = selected.has(photo.id);
                const index = gallery.indexOf.get(photo.id)!;
                return (
                  <div
                    key={photo.id}
                    className={classes.tile}
                    data-selected={picked || undefined}
                    data-selecting={selecting || undefined}
                    style={{
                      flex: `${ratio} 1 ${ratio * ROW_PX}px`,
                      maxWidth: ratio * ROW_PX * MAX_STRETCH,
                    }}
                  >
                    <UnstyledButton
                      className={classes.open}
                      onClick={() => (selecting ? toggle([photo.id], !picked) : setOpen(index))}
                      aria-label={item ? `Receipt for ${item.name}` : 'Photo'}
                    >
                      <img
                        src={attachmentUrl(splitId, photo.id)}
                        alt=""
                        loading="lazy"
                        onLoad={(e) => {
                          const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
                          if (w > 0 && h > 0) setShapes((s) => new Map(s).set(photo.id, w / h));
                        }}
                      />
                    </UnstyledButton>
                    {item && (
                      <span className={classes.itemTag}>
                        <Receipt size={12} />
                        <span>{item.name}</span>
                      </span>
                    )}
                    <div className={classes.strip}>
                      <UserAvatar
                        name={who.name}
                        email={who.email}
                        avatarVersion={who.avatarVersion}
                        color={who.colors?.fill}
                        size={18}
                      />
                      <span
                        className={classes.who}
                        style={{ color: who.colors?.text }}
                      >
                        {who.name}
                      </span>
                      <span>{timeLabel(photo.createdAt)}</span>
                    </div>
                    <UnstyledButton
                      className={classes.check}
                      role="checkbox"
                      aria-checked={picked}
                      aria-label={item ? `Select receipt for ${item.name}` : 'Select photo'}
                      onClick={() => {
                        setSelecting(true);
                        toggle([photo.id], !picked);
                      }}
                    >
                      {picked && <Check size={14} />}
                    </UnstyledButton>
                  </div>
                );
              })}
              {/* Takes up the room left in the last row, so its photos keep their size */}
              <span className={classes.rowEnd} />
            </div>
          </section>
        );
      })}

      <PhotoViewer
        photos={viewer}
        index={open}
        onIndexChange={setOpen}
      />
      {gallery.confirmDialog}
    </div>
  );
};

export default DesktopPhotos;
