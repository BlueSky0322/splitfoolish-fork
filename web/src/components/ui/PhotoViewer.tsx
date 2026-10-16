import { ActionIcon, Modal, Tooltip } from '@mantine/core';
import { CaretLeft, CaretRight, DownloadSimple, Trash, X } from '@phosphor-icons/react';
import { type TouchEvent, useEffect, useRef, useState } from 'react';
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
const MAX_SCALE = 5;
/** A click or double tap zooms to this */
const STEP_SCALE = 2.5;
const DOUBLE_TAP_MS = 300;

interface View {
  scale: number;
  x: number;
  y: number;
}
const FIT: View = { scale: 1, x: 0, y: 0 };

const distance = (
  a: { clientX: number; clientY: number },
  b: { clientX: number; clientY: number },
) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

// Photos full screen, on phones and computers alike: arrows, keys or a swipe move
// between them, and a swipe down closes it. Pinch or double tap to zoom on a phone (and
// drag a zoomed photo around); a click zooms on a computer.
const PhotoViewer = ({ photos, index, onIndexChange }: PhotoViewerProps) => {
  const count = photos.length;
  // A photo removed while open: show the one that took its place, or close
  const current = index == null || count === 0 ? null : Math.min(index, count - 1);
  const photo = current == null ? null : photos[current];
  const [view, setView] = useState<View>(FIT);
  const zoomed = view.scale > 1;
  // One finger: where it started, for a swipe or to drag a zoomed photo.
  // Two: the pinch's starting spread and zoom.
  const touch = useRef<{ x: number; y: number; from: View } | null>(null);
  const pinch = useRef<{ spread: number; from: View } | null>(null);
  const lastTap = useRef(0);
  const touchedAt = useRef(0);
  const [moving, setMoving] = useState(false);

  useEffect(() => setView(FIT), [current]);

  const onTouchStart = (e: TouchEvent) => {
    touchedAt.current = Date.now();
    if (e.touches.length === 2) {
      touch.current = null;
      pinch.current = { spread: distance(e.touches[0], e.touches[1]), from: view };
      setMoving(true);
    } else if (e.touches.length === 1) {
      touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, from: view };
      if (zoomed) setMoving(true);
    }
  };
  const onTouchMove = (e: TouchEvent) => {
    const p = pinch.current;
    if (p && e.touches.length === 2) {
      const scale = Math.min(
        MAX_SCALE,
        Math.max(1, (p.from.scale * distance(e.touches[0], e.touches[1])) / p.spread),
      );
      // Keeps the photo where it was, relative to its own size
      const k = scale / p.from.scale;
      setView({ scale, x: p.from.x * k, y: p.from.y * k });
      return;
    }
    const t = touch.current;
    if (t && zoomed && e.touches.length === 1) {
      setView({
        scale: t.from.scale,
        x: t.from.x + e.touches[0].clientX - t.x,
        y: t.from.y + e.touches[0].clientY - t.y,
      });
    }
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (pinch.current) {
      // Lifting one finger of a pinch ends it, without counting as a swipe
      if (e.touches.length < 2) pinch.current = null;
      if (e.touches.length === 0) {
        setMoving(false);
        setView((v) => (v.scale < 1.05 ? FIT : v));
      }
      return;
    }
    const start = touch.current;
    touch.current = null;
    setMoving(false);
    if (start == null) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    // A tap: a second one soon after zooms in, or back out
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const now = Date.now();
      if (now - lastTap.current < DOUBLE_TAP_MS) {
        lastTap.current = 0;
        setView(zoomed ? FIT : { scale: STEP_SCALE, x: 0, y: 0 });
      } else lastTap.current = now;
      return;
    }
    if (zoomed) return;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
    else if (dy > SWIPE_PX * 2 && dy > Math.abs(dx)) close();
  };

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
            className={classes.stage}
            data-zoomed={zoomed || undefined}
            onClick={(e) => {
              // A tap has done its work already
              if (Date.now() - touchedAt.current < 600) return;
              // A click on the dark area closes; on the photo, zooms in or out
              if (e.target !== e.currentTarget)
                setView(zoomed ? FIT : { scale: STEP_SCALE, x: 0, y: 0 });
              else if (!zoomed) close();
            }}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchEnd}
          >
            <img
              key={photo.key}
              src={photo.src}
              alt={count > 1 ? `Photo ${current! + 1} of ${count}` : 'Photo'}
              className={classes.image}
              data-moving={moving || undefined}
              style={
                zoomed
                  ? { transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }
                  : undefined
              }
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
