import { Avatar } from '@mantine/core';
import { splitPictureUrl } from '../../api';
import { useSplitPicturePreview } from '../../split/pictures';

interface SplitAvatarProps {
  splitId: string;
  name: string;
  pictureVersion?: number | null;
  size?: number;
  active?: boolean;
}

// A split's picture, or its first letter. Rounded squares, so splits never look like people.
const SplitAvatar = ({ splitId, name, pictureVersion, size = 24, active }: SplitAvatarProps) => {
  const preview = useSplitPicturePreview(splitId);
  const src = preview ?? (pictureVersion ? splitPictureUrl(splitId, pictureVersion) : null);
  return (
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
};

export default SplitAvatar;
