import { Switch } from '@mantine/core';
import { useProfile } from '../../profile/ProfileContext';
import SettingsCard from './SettingsCard';
import type { Track } from './useSaveIndicator';

// Locations: whether a new item, and a photo taken here, take where this account's phone is
const PlacesSection = ({ track }: { track: Track }) => {
  const { profile, rememberSettings } = useProfile();
  if (profile == null) return null;
  return (
    <SettingsCard
      title="Locations"
      help="Everyone in the split sees where items were paid for. A place from a receipt photo, a Maps link in the notes or a search is kept either way; remove one from its item."
    >
      <Switch
        label="Record my location for new expenses"
        description="Where your phone is when you add an expense or take a photo here. Your phone asks first."
        checked={profile.settings.recordLocation}
        onChange={(e) => rememberSettings({ recordLocation: e.currentTarget.checked }, track)}
      />
    </SettingsCard>
  );
};

export default PlacesSection;
