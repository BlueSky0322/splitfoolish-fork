import {
  Button,
  FileButton,
  SegmentedControl,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { CaretLeft, Check, LockSimple, SignOut } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { PaymentMethod, ThemeSetting, api } from '../../api';
import { useIsDesktop } from '../../hooks/useBreakpoints';
import { navigate } from '../../hooks/useRoute';
import { nameFor, useProfile } from '../../profile/ProfileContext';
import { clearCache } from '../../split-cache';
import { ACCENTS, Accent } from '../../theme/accents';
import { AVATAR, shrinkImage } from '../../utils/image';
import UserAvatar from '../ui/UserAvatar';
import PayHint from './PayHint';
import PaymentMethods from './PaymentMethods';
import classes from './Settings.module.css';

const THEMES: { value: ThemeSetting; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'auto', label: 'Match device' },
];

const MAX_DISPLAY_NAME = 32;

export async function signOut() {
  await clearCache();
  window.location.href = '/cdn-cgi/access/logout';
}

const fail = (err: unknown, fallback: string) =>
  notifications.show({ color: 'red', message: err instanceof Error ? err.message : fallback });

// Settings (2a). Everything saves as it changes; "Saved" shows once it has.
const SettingsPage = () => {
  const { profile, update, updateSettings, replace } = useProfile();
  const isDesktop = useIsDesktop();
  const [name, setName] = useState(profile?.displayName ?? '');
  const [saving, setSaving] = useState(0);
  const [avatarBusy, setAvatarBusy] = useState(false);

  // Fill the name in once the profile arrives
  useEffect(() => {
    setName(profile?.displayName ?? '');
  }, [profile?.displayName]);

  if (profile == null) return null;
  const myName = nameFor(profile.email, profile.displayName);

  const track = async <T,>(work: Promise<T>) => {
    setSaving((n) => n + 1);
    try {
      return await work;
    } finally {
      setSaving((n) => n - 1);
    }
  };

  const saveName = () => {
    const trimmed = name.trim();
    if (trimmed === (profile.displayName ?? '')) return;
    track(update({ displayName: trimmed || null }));
  };

  const savePayments = async (methods: PaymentMethod[], preferredId: string | null) => {
    try {
      replace(await track(api.setPaymentMethods(methods, preferredId)));
      return true;
    } catch (err) {
      fail(err, 'Could not save your payment methods');
      return false;
    }
  };

  const changeAvatar = async (file: File | null) => {
    if (file == null) return;
    setAvatarBusy(true);
    try {
      const photo = await shrinkImage(file, AVATAR.maxSide, AVATAR.maxBytes);
      const { avatarVersion } = await track(api.setAvatar(photo));
      replace({ ...profile, avatarVersion });
    } catch (err) {
      fail(err, 'Could not change your picture');
    } finally {
      setAvatarBusy(false);
    }
  };

  const removeAvatar = async () => {
    setAvatarBusy(true);
    try {
      await track(api.removeAvatar());
      replace({ ...profile, avatarVersion: null });
    } catch (err) {
      fail(err, 'Could not remove your picture');
    } finally {
      setAvatarBusy(false);
    }
  };

  const savedNote = (
    <span className={classes.saved}>
      {saving > 0 ? (
        'Saving'
      ) : (
        <>
          <Check size={14} /> Saved
        </>
      )}
    </span>
  );

  const profileSection = (
    <section className={classes.section}>
      <h3 className={classes.heading}>Profile</h3>
      <div className={classes.avatarRow}>
        <div className={classes.avatarRing}>
          <UserAvatar
            name={myName}
            email={profile.email}
            avatarVersion={profile.avatarVersion}
            size={60}
            active
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <FileButton
            onChange={changeAvatar}
            accept="image/*"
          >
            {(props) => (
              <Button
                variant="default"
                loading={avatarBusy}
                {...props}
              >
                {profile.avatarVersion ? 'Change picture' : 'Add picture'}
              </Button>
            )}
          </FileButton>
          {profile.avatarVersion && (
            <Button
              variant="subtle"
              color="gray"
              disabled={avatarBusy}
              onClick={removeAvatar}
            >
              Remove
            </Button>
          )}
        </div>
      </div>
      <TextInput
        label="Display name"
        description="Shown to people in your splits instead of your email."
        placeholder={profile.email.split('@')[0]}
        value={name}
        maxLength={MAX_DISPLAY_NAME}
        onChange={(e) => setName(e.target.value)}
        onBlur={saveName}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <TextInput
        label="Email"
        value={profile.email}
        readOnly
        rightSection={
          <LockSimple
            size={16}
            className="sf-muted"
          />
        }
      />
    </section>
  );

  const preferred = profile.paymentMethods.find((m) => m.id === profile.preferredPaymentMethodId);
  const orderedMethods = preferred
    ? [preferred, ...profile.paymentMethods.filter((m) => m !== preferred)]
    : profile.paymentMethods;

  const paymentSection = (
    <section className={classes.section}>
      <h3 className={classes.heading}>Getting paid</h3>
      <p className="sf-muted text-sm">
        Shown to people who owe you, next to their transfer in Settle up.
      </p>
      <PaymentMethods
        methods={profile.paymentMethods}
        preferredId={profile.preferredPaymentMethodId}
        onChange={savePayments}
      />
      {orderedMethods.length > 0 && (
        <div className={classes.preview}>
          <div className="sf-label">What someone who owes you sees</div>
          <PayHint
            name={myName}
            amountCents={10250}
            currency={profile.settings.lastCurrency ?? 'MYR'}
            methods={orderedMethods}
          />
        </div>
      )}
    </section>
  );

  const appearanceSection = (
    <section className={classes.section}>
      <h3 className={classes.heading}>Appearance</h3>
      <div className={classes.field}>
        <div className={classes.label}>Theme</div>
        <SegmentedControl
          fullWidth
          data={THEMES}
          value={profile.settings.theme}
          onChange={(theme) => track(updateSettings({ theme: theme as ThemeSetting }))}
        />
      </div>
      <div className={classes.field}>
        <div className={classes.label}>Accent colour</div>
        <div
          className={classes.swatches}
          role="radiogroup"
          aria-label="Accent colour"
        >
          {(Object.keys(ACCENTS) as Accent[]).map((key) => {
            const selected = profile.settings.accent === key;
            return (
              <UnstyledButton
                key={key}
                role="radio"
                aria-checked={selected}
                aria-label={ACCENTS[key].label}
                title={ACCENTS[key].label}
                className={classes.swatch}
                data-selected={selected || undefined}
                style={{ '--swatch': ACCENTS[key].ramp[4] } as React.CSSProperties}
                onClick={() => track(updateSettings({ accent: key }))}
              >
                {selected && (
                  <Check
                    size={16}
                    weight="bold"
                  />
                )}
              </UnstyledButton>
            );
          })}
        </div>
      </div>
    </section>
  );

  const accountSection = (
    <section className={classes.section}>
      <h3 className={classes.heading}>Account</h3>
      <div>
        <Button
          variant="default"
          leftSection={<SignOut size={16} />}
          onClick={signOut}
        >
          Sign out
        </Button>
      </div>
    </section>
  );

  return (
    <div className={classes.page}>
      {isDesktop ? (
        <div className={classes.header}>
          <Title order={2}>Settings</Title>
          {savedNote}
        </div>
      ) : (
        <div className={classes.topBar}>
          <Button
            variant="subtle"
            color="gray"
            leftSection={<CaretLeft size={16} />}
            onClick={() => navigate('')}
          >
            Settings
          </Button>
          {savedNote}
        </div>
      )}

      {isDesktop ? (
        <div className={classes.columns}>
          <div className={classes.column}>
            {profileSection}
            {paymentSection}
          </div>
          <div className={classes.column}>
            {appearanceSection}
            {accountSection}
          </div>
        </div>
      ) : (
        <div className={classes.column}>
          {profileSection}
          {paymentSection}
          {appearanceSection}
          {accountSection}
        </div>
      )}
    </div>
  );
};

export default SettingsPage;
