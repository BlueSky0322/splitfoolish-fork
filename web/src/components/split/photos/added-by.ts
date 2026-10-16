import { nameFor } from '../../../profile/ProfileContext';
import { useSplitPage } from '../SplitPageContext';

/** "21:14", as the device writes times */
export const timeLabel = (time: number) =>
  new Date(time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** Who added a photo: their name and picture, as a member of the split */
export function useAddedBy() {
  const { meta } = useSplitPage();
  return (email: string) => {
    const member = meta?.members.find((m) => m.email === email);
    return {
      name: nameFor(email, member?.displayName),
      email,
      avatarVersion: member?.avatarVersion ?? null,
    };
  };
}
