import { Avatar } from '@mantine/core';
import { avatarUrl } from '../../api';

interface UserAvatarProps {
  /** The name the initial comes from */
  name: string;
  /** With a version, the account's profile picture is shown */
  email?: string | null;
  avatarVersion?: number | null;
  size?: number;
  active?: boolean;
}

// A round avatar: the profile picture when there is one, else the first letter
const UserAvatar = ({ name, email, avatarVersion, size = 26, active }: UserAvatarProps) => (
  <Avatar
    src={email && avatarVersion ? avatarUrl(email, avatarVersion) : null}
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

export default UserAvatar;
