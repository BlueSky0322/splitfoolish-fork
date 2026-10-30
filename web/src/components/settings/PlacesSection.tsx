import { Switch } from '@mantine/core';
import { useProfile } from '../../profile/ProfileContext';
import SettingsCard from './SettingsCard';
import type { Track } from './useSaveIndicator';

// Locations: whether this account's photos and items keep where they were
const PlacesSection = ({ track }: { track: Track }) => {
  const { profile, rememberSettings } = useProfile();
  if (profile == null) return null;
  return (
    <SettingsCard
      title="Save locations"
      help="Everyone in the split sees them. Turning this off keeps the ones already saved; remove one from its item."
    >
      <Switch
        label="Save where photos are taken and items paid for"
        description="From the photo itself, or from your phone when you take one here. Your phone asks first."
        checked={profile.settings.savePlaces}
        onChange={(e) => rememberSettings({ savePlaces: e.currentTarget.checked }, track)}
      />
    </SettingsCard>
  );
};

export default PlacesSection;
