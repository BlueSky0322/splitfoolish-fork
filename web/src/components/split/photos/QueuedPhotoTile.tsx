import { ActionIcon, Loader } from '@mantine/core';
import ViewablePicture from '../../ui/ViewablePicture';
import { CloudSlash, X } from '@phosphor-icons/react';
import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import type { QueuedPhoto } from '../../../split/usePhotos';
import { useBlobUrls } from './blob-urls';
import classes from './QueuedPhotoTile.module.css';

/**
 * A photo on the Photos tab that isn't uploaded yet: a spinner while it's on its way,
 * or the photo marked as waiting (offline, say), which can still be removed
 */
const QueuedPhotoTile = ({
  photo,
  className,
  style,
  onRemove,
}: {
  photo: QueuedPhoto;
  /** The tab's own tile, for its size and shape */
  className: string;
  style?: CSSProperties;
  onRemove: () => void;
}) => {
  const image = photo.busy ? null : photo.image;
  const urls = useBlobUrls(useMemo(() => (image ? [image] : []), [image]));
  const url = image ? urls.get(image) : undefined;
  return (
    <div
      className={className}
      style={style}
    >
      {photo.busy ? (
        <Loader size="sm" />
      ) : (
        <>
          {url && (
            <ViewablePicture
              src={url}
              label="View photo waiting to upload"
              className={classes.image}
            >
              <img
                className={classes.image}
                src={url}
                alt=""
              />
            </ViewablePicture>
          )}
          <span className={classes.waiting}>
            <CloudSlash size={12} />
            Waiting to upload
          </span>
          <ActionIcon
            className={classes.remove}
            size={22}
            radius="xl"
            variant="default"
            aria-label={`Remove ${photo.name}`}
            onClick={onRemove}
          >
            <X size={12} />
          </ActionIcon>
        </>
      )}
    </div>
  );
};

export default QueuedPhotoTile;
