import { UnstyledButton } from '@mantine/core';
import { type KeyboardEvent, type ReactNode, type SyntheticEvent, useState } from 'react';
import PhotoViewer from './PhotoViewer';
import classes from './ViewablePicture.module.css';

interface ViewablePictureProps {
  /** The picture shown full size; without one, the children are shown as they are */
  src: string | null | undefined;
  /** What the button says to screen readers, like "View Ann's picture" */
  label: string;
  /** Saved under this name from the viewer */
  fileName?: string;
  /** Round, for avatars, so the focus ring and hover follow the picture */
  round?: boolean;
  /** Fills the box it's in, for a picture sized to fill it */
  fill?: boolean;
  className?: string;
  children: ReactNode;
}

/** Keeps a tap from also reaching a row or chip around the picture */
const stop = (e: SyntheticEvent) => e.stopPropagation();

// A picture that opens full size when tapped. It works inside a row, chip or toggle that
// does something else on a tap: the tap opens the picture and goes no further, and so do
// taps in the viewer, which React passes up through its portal.
const ViewablePicture = ({
  src,
  label,
  fileName,
  round,
  fill,
  className,
  children,
}: ViewablePictureProps) => {
  const [open, setOpen] = useState(false);
  if (!src) return children;

  const show = (e: SyntheticEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setOpen(true);
  };
  return (
    <>
      <UnstyledButton
        // A span, so it can sit inside a button without nesting one button in another
        component="span"
        role="button"
        tabIndex={0}
        aria-label={label}
        className={`${classes.trigger} ${className ?? ''}`}
        data-round={round || undefined}
        data-fill={fill || undefined}
        onClick={show}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') show(e);
        }}
      >
        {children}
      </UnstyledButton>
      <span
        onClick={stop}
        onKeyDown={stop}
        onPointerDown={stop}
        className={classes.viewer}
      >
        <PhotoViewer
          photos={[{ key: src, src, fileName }]}
          index={open ? 0 : null}
          onIndexChange={(ix) => setOpen(ix != null)}
        />
      </span>
    </>
  );
};

export default ViewablePicture;
