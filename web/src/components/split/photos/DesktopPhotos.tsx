import { Button, Menu, SegmentedControl, Tooltip, UnstyledButton } from '@mantine/core';
import {
  CaretDown,
  Check,
  CheckSquare,
  DownloadSimple,
  Receipt,
  SortAscending,
  SortDescending,
  Trash,
  UploadSimple,
  X,
} from '@phosphor-icons/react';
import { type DragEvent, useMemo, useRef, useState } from 'react';
import { attachmentUrl } from '../../../api';
import {
  DEFAULT_PHOTO_VIEW,
  type PhotoFilter,
  type PhotoSortDir,
  type PhotoSortKey,
  type PhotoView,
  photoCounts,
  photoDays,
} from '../../../split/photo-days';
import { usePhotoDownload } from '../../../split/photo-download';
import { useSplitState } from '../../../split/SplitStateContext';
import PhotoViewer, { type ViewerPhoto } from '../../ui/PhotoViewer';
import UserAvatar from '../../common/UserAvatar';
import { useSplitPage } from '../SplitPageContext';
import classes from './DesktopPhotos.module.css';
import { timeLabel, useAddedBy } from './added-by';
import PhotoDetails from './PhotoDetails';
import QueuedPhotoTile from './QueuedPhotoTile';
import { useConfirmRemovePhotos } from './useConfirmRemovePhotos';

/** Every row of photos is this tall; each photo is as wide as its shape makes it */
const ROW_PX = 150;
/** A photo stretches to fill its row by at most this much */
const MAX_STRETCH = 1.6;

const SORT_LABELS: Record<PhotoSortKey, string> = { added: 'Date added', item: 'Item date' };
const DIRECTION_LABELS: Record<PhotoSortDir, string> = {
  desc: 'Newest first',
  asc: 'Oldest first',
};

const imagesIn = (list: DataTransfer) =>
  [...list.items].filter((i) => i.kind === 'file' && i.type.startsWith('image/')).length;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The split's Photos tab on a computer: every photo, the split's own and each item's
// receipts, by day in rows that keep each photo's shape. Choose which to show and in
// what order, select some to download or remove, and drop files on it to add them.
const DesktopPhotos = () => {
  const { splitId, meta, photos, canRemovePhoto, openDialog } = useSplitPage();
  const { items } = useSplitState().state;
  const addedBy = useAddedBy();
  const [view, setView] = useState<PhotoView>(DEFAULT_PHOTO_VIEW);
  const [open, setOpen] = useState<number | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Several photos are saved as one zip
  const saving = usePhotoDownload(splitId, meta?.name ?? '', { zip: true });
  // How many photos are being dragged over the tab, while they are
  const [dragging, setDragging] = useState(0);
  const dragDepth = useRef(0);
  // Width over height of each photo, once it has loaded
  const [shapes, setShapes] = useState<Map<string, number>>(new Map());

  const all = useMemo(() => meta?.attachments ?? [], [meta?.attachments]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const days = useMemo(
    () => photoDays(all, new Map(items.map((i) => [i.id, i.createdAt])), view),
    [all, items, view],
  );
  const counts = photoCounts(all);
  const shown = days.flatMap((d) => d.photos);
  const queued = photos.queuedOf(null);

  // Selected photos still there (one removed elsewhere drops out)
  const chosen = shown.filter((p) => selected.has(p.id));
  const canRemoveAll = chosen.length > 0 && chosen.every(canRemovePhoto);

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

  const { confirm, dialog: confirmDialog } = useConfirmRemovePhotos();
  const viewer: ViewerPhoto[] = shown.map((photo) => {
    const onRemove = canRemovePhoto(photo)
      ? () => confirm(1, () => photos.remove(photo))
      : undefined;
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

  const onDragEnter = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragDepth.current++;
    setDragging(Math.max(1, imagesIn(e.dataTransfer)));
  };
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(0);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(0);
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    if (files.length > 0) void photos.upload(files, null);
  };

  return (
    <div
      className={classes.tab}
      onDragEnter={onDragEnter}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
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
            disabled={canRemoveAll || chosen.length === 0}
          >
            <Button
              variant="default"
              size="xs"
              className="sf-danger-outline"
              leftSection={<Trash size={14} />}
              disabled={!canRemoveAll}
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
      ) : (
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
          <SegmentedControl
            size="xs"
            value={view.filter}
            onChange={(filter) => setView((v) => ({ ...v, filter: filter as PhotoFilter }))}
            aria-label="Show"
            data={[
              {
                value: 'all',
                label: (
                  <FilterLabel
                    label="All"
                    count={counts.all}
                  />
                ),
              },
              {
                value: 'receipts',
                label: (
                  <FilterLabel
                    label="Receipts"
                    count={counts.receipts}
                  />
                ),
              },
              {
                value: 'split',
                label: (
                  <FilterLabel
                    label="Split photos"
                    count={counts.split}
                  />
                ),
              },
            ]}
          />
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

      {dragging > 0 && (
        <div className={classes.dropZone}>
          <UploadSimple size={20} />
          <div className={classes.dropTitle}>
            {dragging > 1 ? `Drop to add ${dragging} photos` : 'Drop to add photos'}
          </div>
          <div className={classes.dropHint}>
            They're added as split photos. Receipts are added on their item.
          </div>
        </div>
      )}

      {queued.length > 0 && (
        <div className={classes.row}>
          {queued.map((photo) => (
            <QueuedPhotoTile
              key={photo.id}
              photo={photo}
              className={`${classes.tile} ${classes.adding}`}
              style={{ flex: `1 1 ${ROW_PX}px`, maxWidth: ROW_PX * MAX_STRETCH }}
              onRemove={() => photos.removeQueued(photo)}
            />
          ))}
          <span className={classes.rowEnd} />
        </div>
      )}

      {shown.length === 0 && queued.length === 0 && dragging === 0 && (
        <p className="sf-muted text-sm text-center py-10">
          {all.length === 0
            ? 'No photos yet. Drop some here, or add a receipt on its item.'
            : view.filter === 'receipts'
              ? 'No receipts yet. Add one on its item.'
              : 'No photos of the split yet. Drop some here.'}
        </p>
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
                const index = shown.indexOf(photo);
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
                      aria-label={item ? `Receipt for ${item.name}` : 'Photo of the split'}
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
                        color={who.color}
                        size={18}
                        preview={false}
                      />
                      <span className={classes.who}>{who.name}</span>
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
      {confirmDialog}
    </div>
  );
};

export default DesktopPhotos;

const FilterLabel = ({ label, count }: { label: string; count: number }) => (
  <span className={classes.filter}>
    {label}
    <span className={classes.filterCount}>{count}</span>
  </span>
);

/** The page's main button on the Photos tab: picks photos to add to the split */
export function AddPhotosButton({ disabled, miw }: { disabled?: boolean; miw?: number }) {
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
      <Button
        miw={miw}
        leftSection={<UploadSimple size={16} />}
        onClick={() => picker.current?.click()}
        disabled={disabled}
      >
        Add photos
      </Button>
    </>
  );
}
