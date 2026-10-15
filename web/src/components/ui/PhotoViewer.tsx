import { ActionIcon, Modal, Tooltip } from '@mantine/core';
import { CaretLeft, CaretRight, DownloadSimple, Trash, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useBackDismiss } from '../../hooks/useBackDismiss';
import classes from './PhotoViewer.module.css';

export interface ViewerPhoto {
  key: string;
  src: string;
  /** Removes it; absent when this person can't */
  onRemove?: () => void;
}

interface PhotoViewerProps {
  photos: ViewerPhoto[];
  /** Which one is open, or null when closed */
  index: number | null;
  onIndexChange: (index: number | null) => void;
}

const SWIPE_PX = 50;

// Photos full screen, on phones and computers alike: arrows, keys or a swipe move
// between them, a tap (or click) zooms in, and a swipe down closes it
const PhotoViewer = ({ photos, index, onIndexChange }: PhotoViewerProps) => {
  const count = photos.length;
  // A photo removed while open: show the one that took its place, or close
  const current = index == null || count === 0 ? null : Math.min(index, count - 1);
  const photo = current == null ? null : photos[current];
  const [zoomed, setZoomed] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => setZoomed(false), [current]);

  const go = (step: number) => {
    if (current == null || count < 2) return;
    onIndexChange((current + step + count) % count);
  };
  const close = () => onIndexChange(null);

  useEffect(() => {
    if (photo == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Back on a phone closes the photo, not the page under it
  useBackDismiss(photo != null, close);

  return (
    <Modal
      opened={photo != null}
      onClose={close}
      fullScreen
      withCloseButton={false}
      transitionProps={{ transition: 'fade', duration: 150 }}
      classNames={{ content: classes.content, body: classes.body }}
    >
      {photo && (
        <>
          <div className={classes.bar}>
            <span className={classes.count}>{count > 1 ? `${current! + 1} of ${count}` : ''}</span>
            <Tooltip label="Download">
              <ActionIcon
                component="a"
                href={photo.src}
                download
                variant="subtle"
                color="gray"
                size={40}
                className={classes.tool}
                aria-label="Download photo"
              >
                <DownloadSimple size={20} />
              </ActionIcon>
            </Tooltip>
            {photo.onRemove && (
              <Tooltip label="Remove photo">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size={40}
                  className={classes.tool}
                  aria-label="Remove photo"
                  onClick={() => {
                    photo.onRemove!();
                    if (count === 1) close();
                  }}
                >
                  <Trash size={20} />
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip label="Close">
              <ActionIcon
                variant="subtle"
                color="gray"
                size={40}
                className={classes.tool}
                aria-label="Close"
                onClick={close}
                data-autofocus
              >
                <X size={20} />
              </ActionIcon>
            </Tooltip>
          </div>

          <div
            className={`${classes.stage} ${zoomed ? classes.zoomed : ''}`}
            onClick={(e) => {
              // A click on the dark area closes; on the photo, zooms
              if (e.target === e.currentTarget && !zoomed) close();
            }}
            onTouchStart={(e) => {
              if (zoomed || e.touches.length !== 1) return;
              touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }}
            onTouchEnd={(e) => {
              const start = touch.current;
              touch.current = null;
              if (start == null || zoomed) return;
              const dx = e.changedTouches[0].clientX - start.x;
              const dy = e.changedTouches[0].clientY - start.y;
              if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
              else if (dy > SWIPE_PX * 2 && dy > Math.abs(dx)) close();
            }}
          >
            <img
              key={photo.key}
              src={photo.src}
              alt={count > 1 ? `Photo ${current! + 1} of ${count}` : 'Photo'}
              className={classes.image}
              onClick={() => setZoomed((z) => !z)}
              draggable={false}
            />
          </div>

          {count > 1 && (
            <>
              <ActionIcon
                className={`${classes.nav} ${classes.prev}`}
                variant="subtle"
                radius="xl"
                size={44}
                aria-label="Previous photo"
                onClick={() => go(-1)}
              >
                <CaretLeft size={20} />
              </ActionIcon>
              <ActionIcon
                className={`${classes.nav} ${classes.next}`}
                variant="subtle"
                radius="xl"
                size={44}
                aria-label="Next photo"
                onClick={() => go(1)}
              >
                <CaretRight size={20} />
              </ActionIcon>
              <div className={classes.thumbs}>
                {photos.map((p, ix) => (
                  <button
                    key={p.key}
                    type="button"
                    className={`${classes.thumb} ${ix === current ? classes.active : ''}`}
                    aria-label={`Show photo ${ix + 1}`}
                    aria-current={ix === current}
                    onClick={() => onIndexChange(ix)}
                  >
                    <img
                      src={p.src}
                      alt=""
                    />
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
};

export default PhotoViewer;
