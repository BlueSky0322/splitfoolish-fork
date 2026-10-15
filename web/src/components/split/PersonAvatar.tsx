import { createContext, useContext } from 'react';
import { Person } from '../../split/state';
import UserAvatar from '../ui/UserAvatar';

/** Profile picture versions by account email, for people linked to an account */
export const AvatarVersionsContext = createContext<Map<string, number | null>>(new Map());

// A person in the bill: their profile picture when they're linked to an account that
// has one, else their initial
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
  return (
    <UserAvatar
      name={person.name}
      email={email}
      avatarVersion={email ? versions.get(email) : null}
      size={size}
      active={active}
      preview={preview}
    />
  );
};

export default PersonAvatar;
