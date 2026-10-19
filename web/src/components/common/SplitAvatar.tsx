import { Avatar } from '@mantine/core';
import { splitPictureUrl } from '../../api';
import { useSplitPicturePreview } from '../../split/pictures';
import ViewablePicture from '../ui/ViewablePicture';

interface SplitAvatarProps {
  splitId: string;
  name: string;
  pictureVersion?: number | null;
  size?: number;
  active?: boolean;
  /**
   * Tapping its picture shows it full size. Off where the avatar is a link to the
   * split, as in lists of splits.
   */
  preview?: boolean;
}

// A split's picture, or its first letter. Rounded squares, so splits never look like people.
const SplitAvatar = ({
  splitId,
  name,
  pictureVersion,
  size = 24,
  active,
  preview = false,
}: SplitAvatarProps) => {
  const picked = useSplitPicturePreview(splitId);
  const src = picked ?? (pictureVersion ? splitPictureUrl(splitId, pictureVersion) : null);
  const avatar = (
    <Avatar
      src={src}
      alt={name}
      size={size}
      radius={Math.round(size * 0.24)}
      styles={{
        placeholder: {
          background: active ? 'var(--sf-accent-tint)' : 'var(--sf-tag)',
          color: active ? 'var(--sf-accent)' : 'var(--sf-text)',
          fontSize: Math.round(size * 0.42),
          fontWeight: 500,
        },
      }}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </Avatar>
  );
  if (!preview) return avatar;
  return (
    <ViewablePicture
      src={src}
      label={`View ${name}'s picture`}
    >
      {avatar}
    </ViewablePicture>
  );
};

export default SplitAvatar;
