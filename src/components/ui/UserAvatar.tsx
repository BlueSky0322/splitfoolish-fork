import { Avatar, Modal, UnstyledButton } from '@mantine/core';
import { useState } from 'react';
import { avatarUrl } from '../../api';
import classes from './UserAvatar.module.css';

interface UserAvatarProps {
  /** The name the initial comes from */
  name: string;
  /** With a version, the account's profile picture is shown */
  email?: string | null;
  avatarVersion?: number | null;
  size?: number;
  active?: boolean;
  /** Clicking a profile picture shows it full size */
  preview?: boolean;
}

// A round avatar: the profile picture when there is one, else the first letter
const UserAvatar = ({
  name,
  email,
  avatarVersion,
  size = 26,
  active,
  preview,
}: UserAvatarProps) => {
  const [open, setOpen] = useState(false);
  const src = email && avatarVersion ? avatarUrl(email, avatarVersion) : null;

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
      <Modal
        opened={open}
        onClose={() => setOpen(false)}
        title={name}
        centered
        size="auto"
        classNames={{ body: classes.previewBody }}
      >
        <img
          src={src}
          alt={`${name}'s profile picture`}
          className={classes.previewImage}
        />
      </Modal>
    </>
  );
};

export default UserAvatar;
