import { createContext, useContext } from 'react';
import type { Person } from '@shared/types';
import UserAvatar from '../common/UserAvatar';
import { usePersonColor } from './person-colors-context';

/** Profile picture versions by account email, for people linked to an account */
export const AvatarVersionsContext = createContext<Map<string, number | null>>(new Map());

/** A person's colour beside their name, where it has no avatar of its own */
export const PersonDot = ({ person }: { person: Person }) => {
  const color = usePersonColor({ personId: person.id });
  if (color == null) return null;
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        flexShrink: 0,
        width: 8,
        height: 8,
        marginRight: 6,
        borderRadius: 999,
        background: color,
        verticalAlign: 'middle',
      }}
    />
  );
};

// A person in the bill: their profile picture when they're linked to an account that
// has one, else their initial on their colour
const PersonAvatar = ({
  person,
  size,
  active,
  preview,
}: {
  person: Person;
  size?: number;
  active?: boolean;
  preview?: boolean;
}) => {
  const versions = useContext(AvatarVersionsContext);
  const email = person.memberEmail ?? null;
  const color = usePersonColor({ personId: person.id });
  return (
    <UserAvatar
      name={person.name}
      email={email}
      avatarVersion={email ? versions.get(email) : null}
      size={size}
      active={active}
      preview={preview}
      color={color}
    />
  );
};

export default PersonAvatar;
