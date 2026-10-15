import { Loader, UnstyledButton } from '@mantine/core';
import { useMemo, useRef, useState } from 'react';
import { attachmentUrl } from '../../../api';
import { dayKey, dayLabel } from '../../../split/grouping';
import { useSplitState } from '../../../split/SplitStateContext';
import Fab from '../../ui/Fab';
import PhotoViewer, { type ViewerPhoto } from '../../ui/PhotoViewer';
import { useSplitPage } from '../SplitPageContext';
import classes from './PhotosTab.module.css';

// The split's Photos tab on a phone: every photo, the split's own and each item's
// receipts, by the day it was added, newest first, with the item it belongs to
const PhotosTab = () => {
  const { splitId, meta, photos, canRemovePhoto } = useSplitPage();
  const { items } = useSplitState().state;
  const [open, setOpen] = useState<number | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const uploading = photos.uploading[''] ?? [];

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
  const viewer: ViewerPhoto[] = all.map((photo) => ({
    key: photo.id,
    src: attachmentUrl(splitId, photo.id),
    onRemove: canRemovePhoto(photo) ? () => photos.remove(photo) : undefined,
  }));

  return (
    <div className={classes.tab}>
      {uploading.length > 0 && (
        <div className={classes.grid}>
          {uploading.map((file) => (
            <div
              key={`${file.name}-${file.lastModified}`}
              className={classes.tile}
            >
              <Loader size="sm" />
            </div>
          ))}
        </div>
      )}
      {all.length === 0 && uploading.length === 0 && (
        <p className="sf-muted text-sm text-center py-10">
          No photos yet. Add some of the trip here, or a receipt on its item.
        </p>
      )}
      {days.map((day) => (
        <section key={day.key}>
          <h2 className={classes.day}>{day.label}</h2>
          <div className={classes.grid}>
            {all.slice(day.start, day.start + day.count).map((photo, i) => {
              const label = photo.itemId ? nameOf.get(photo.itemId) : null;
              return (
                <UnstyledButton
                  key={photo.id}
                  className={classes.tile}
                  onClick={() => setOpen(day.start + i)}
                  aria-label={label ? `Photo of ${label}` : 'Photo of the split'}
                >
                  <img
                    src={attachmentUrl(splitId, photo.id)}
                    alt=""
                    loading="lazy"
                  />
                  {label && <span className={classes.label}>{label}</span>}
                </UnstyledButton>
              );
            })}
          </div>
        </section>
      ))}
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
      <PhotoViewer
        photos={viewer}
        index={open}
        onIndexChange={setOpen}
      />
    </div>
  );
};

export default PhotosTab;
