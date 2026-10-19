import { nameFor } from '../../../profile/ProfileContext';
import { usePersonColors } from '../person-colors-context';
import { useSplitPage } from '../SplitPageContext';

/** "21:14", as the device writes times */
export const timeLabel = (time: number) =>
  new Date(time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * Who added a photo: their name and picture, as a member of the split, and the colour
 * of the person they are in it
 */
export function useAddedBy() {
  const { meta } = useSplitPage();
  const colorOf = usePersonColors();
  return (email: string) => {
    const member = meta?.members.find((m) => m.email === email);
    return {
      name: nameFor(email, member?.displayName),
      email,
      avatarVersion: member?.avatarVersion ?? null,
      colors: colorOf({ email }),
    };
  };
}
