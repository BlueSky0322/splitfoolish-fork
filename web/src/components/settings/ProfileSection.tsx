import { Button, FileButton, TextInput } from '@mantine/core';
import { LockSimple } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../api';
import { nameFor, useProfile } from '../../profile/ProfileContext';
import { shrinkAvatar } from '../../utils/image';
import UserAvatar from '../ui/UserAvatar';
import SettingsCard from './SettingsCard';
import type { Track } from './useSaveIndicator';
import classes from './SettingsLayout.module.css';
import { MAX_DISPLAY_NAME } from '../../../../shared/api';
import { showError } from '../../utils/notify';

// Profile: your picture, the name people see, and the email you sign in with
const ProfileSection = ({ track }: { track: Track }) => {
  const { profile, update, patch } = useProfile();
  // What's typed, until it's saved; the saved name otherwise
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? profile?.displayName ?? '';
  const [busy, setBusy] = useState(false);

  if (profile == null) return null;
  const myName = nameFor(profile.email, profile.displayName);

  const saveName = () => {
    const trimmed = name.trim();
    setDraft(null);
    if (trimmed === (profile.displayName ?? '')) return;
    track(update({ displayName: trimmed || null })).catch((err: unknown) =>
      showError(err, 'Could not save your name'),
    );
  };

  // The new picture shows from this device while it uploads
  const changeAvatar = async (file: File | null) => {
    if (file == null) return;
    setBusy(true);
    let preview: string | null = null;
    try {
      const photo = await shrinkAvatar(file);
      preview = URL.createObjectURL(photo);
      const shown = preview;
      patch((p) => ({ ...p, avatarPreview: shown }));
      const { avatarVersion } = await track(api.setAvatar(photo));
      patch((p) => ({ ...p, avatarVersion }));
    } catch (err) {
      showError(err, 'Could not change your picture');
    } finally {
      // Keep showing the local copy until the uploaded one has loaded
      const shown = preview;
      if (shown) {
        setTimeout(() => {
          patch((p) => (p.avatarPreview === shown ? { ...p, avatarPreview: null } : p));
          URL.revokeObjectURL(shown);
        }, 3000);
      }
      setBusy(false);
    }
  };

  const removeAvatar = () => {
    const before = profile.avatarVersion;
    patch((p) => ({ ...p, avatarVersion: null, avatarPreview: null }));
    track(api.deleteAvatar()).catch((err) => {
      patch((p) => ({ ...p, avatarVersion: before }));
      showError(err, 'Could not remove your picture');
    });
  };

  return (
    <>
      <SettingsCard>
        <div className={classes.identity}>
          <UserAvatar
            name={myName}
            email={profile.email}
            avatarVersion={profile.avatarVersion}
            previewSrc={profile.avatarPreview}
            size={64}
          />
          <div className="min-w-0 flex-1">
            <div className={classes.identityName}>{myName}</div>
            <div className={classes.identityEmail}>{profile.email}</div>
          </div>
          <div className={classes.identityActions}>
            <FileButton
              onChange={changeAvatar}
              accept="image/*"
            >
              {(props) => (
                <Button
                  variant="default"
                  size="compact-md"
                  loading={busy}
                  {...props}
                >
                  {profile.avatarVersion ? 'Change picture' : 'Add picture'}
                </Button>
              )}
            </FileButton>
            {(profile.avatarVersion || profile.avatarPreview) && (
              <Button
                variant="subtle"
                color="gray"
                size="compact-md"
                disabled={busy}
                onClick={removeAvatar}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      </SettingsCard>

      <SettingsCard>
        <TextInput
          label="Display name"
          description="Shown to people in your splits instead of your email."
          inputWrapperOrder={['label', 'input', 'description']}
          placeholder={profile.email.split('@')[0]}
          value={name}
          maxLength={MAX_DISPLAY_NAME}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <TextInput
          label="Email"
          description="From your sign-in. It can't be changed here."
          inputWrapperOrder={['label', 'input', 'description']}
          value={profile.email}
          readOnly
          classNames={{ input: classes.readOnly }}
          rightSection={<LockSimple size={14} />}
        />
      </SettingsCard>
    </>
  );
};

export default ProfileSection;
