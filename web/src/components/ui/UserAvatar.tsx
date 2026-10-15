import { Avatar, UnstyledButton } from '@mantine/core';
import { useState } from 'react';
import { avatarUrl } from '../../api';
import PhotoViewer from './PhotoViewer';
import classes from './UserAvatar.module.css';

interface UserAvatarProps {
  /** The name the initial comes from */
  name: string;
  /** With a version, the account's profile picture is shown */
  email?: string | null;
  avatarVersion?: number | null;
  size?: number;
  active?: boolean;
  /**
   * Tapping a profile picture shows it full size. Off where the avatar sits inside
   * something that already does something when tapped, such as a row or a chip.
   */
  preview?: boolean;
  /** A picture to show instead, such as one still uploading */
  previewSrc?: string | null;
}

// A round avatar: the profile picture when there is one, else the first letter
const UserAvatar = ({
  name,
  email,
  avatarVersion,
  size = 26,
  active,
  preview = true,
  previewSrc,
}: UserAvatarProps) => {
  const [open, setOpen] = useState(false);
  const src = previewSrc ?? (email && avatarVersion ? avatarUrl(email, avatarVersion) : null);

  const avatar = (
    <Avatar
      src={src}
      alt={name}
      size={size}
      radius={9999}
      styles={{
        placeholder: {
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

  if (!preview || src == null) return avatar;

  return (
    <>
      <UnstyledButton
        className={classes.trigger}
        aria-label={`View ${name}'s picture`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {avatar}
      </UnstyledButton>
      <PhotoViewer
        photos={[{ key: src, src }]}
        index={open ? 0 : null}
        onIndexChange={(ix) => setOpen(ix != null)}
      />
    </>
  );
};

export default UserAvatar;
