import { Avatar } from '@mantine/core';
import { avatarUrl } from '../../api';
import ViewablePicture from '../ui/ViewablePicture';

interface UserAvatarProps {
  /** The name the initial comes from */
  name: string;
  /** With a version, the account's profile picture is shown */
  email?: string | null;
  avatarVersion?: number | null;
  size?: number;
  active?: boolean;
  /**
   * Tapping a profile picture shows it full size, inside a row or chip too. Off only
   * where the avatar is itself a link somewhere, such as your own to Settings.
   */
  preview?: boolean;
  /** A picture to show instead, such as one still uploading */
  previewSrc?: string | null;
  /** A person's colour in a split (a CSS colour), filling the initial's circle */
  color?: string | null;
}

// A round avatar: the profile picture when there is one, else the first letter, on the
// person's colour in a split
const UserAvatar = ({
  name,
  email,
  avatarVersion,
  size = 26,
  active,
  preview = true,
  previewSrc,
  color,
}: UserAvatarProps) => {
  const src = previewSrc ?? (email && avatarVersion ? avatarUrl(email, avatarVersion) : null);

  const avatar = (
    <Avatar
      src={src}
      alt={name}
      size={size}
      radius={9999}
      styles={{
        placeholder: color
          ? {
              background: color,
              color: 'var(--sf-person-ink)',
              fontSize: Math.round(size * 0.42),
              fontWeight: 600,
            }
          : {
              background: 'var(--sf-avatar)',
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
      round
    >
      {avatar}
    </ViewablePicture>
  );
};

export default UserAvatar;
