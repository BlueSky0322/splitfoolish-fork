import {
  Button,
  FileButton,
  SegmentedControl,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { CaretLeft, Check, LockSimple, Plus, SignOut } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { PaymentMethod, ThemeSetting, api } from '../../api';
import { useIsDesktop, useIsMobile } from '../../hooks/useBreakpoints';
import { navigate } from '../../hooks/useRoute';
import { nameFor, useProfile } from '../../profile/ProfileContext';
import { clearCache } from '../../split-cache';
import { ACCENTS, Accent, isAccent } from '../../theme/accents';
import { AVATAR, shrinkImage } from '../../utils/image';
import UserAvatar from '../ui/UserAvatar';
import PayHint from './PayHint';
import PaymentMethods from './PaymentMethods';
import classes from './Settings.module.css';

const MAX_DISPLAY_NAME = 32;
const SAVED_FOR_MS = 2000;

export async function signOut() {
  await clearCache();
  window.location.href = '/cdn-cgi/access/logout';
}

const fail = (err: unknown, fallback: string) =>
  notifications.show({ color: 'red', message: err instanceof Error ? err.message : fallback });

/** "Saving" while changes are on their way, then "Saved" for a moment */
function useSaveIndicator() {
  const [pending, setPending] = useState(0);
  const [justSaved, setJustSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const track = async <T,>(work: Promise<T>) => {
    clearTimeout(timer.current);
    setJustSaved(false);
    setPending((n) => n + 1);
    try {
      return await work;
    } finally {
      setPending((n) => n - 1);
      setJustSaved(true);
      timer.current = setTimeout(() => setJustSaved(false), SAVED_FOR_MS);
    }
  };

  const note = (
    <span
      className={classes.saved}
      data-visible={pending > 0 || justSaved || undefined}
      aria-live="polite"
    >
      {pending > 0 ? (
        'Saving'
      ) : justSaved ? (
        <>
          <Check size={14} /> Saved
        </>
      ) : null}
    </span>
  );

  return { track, note };
}

// Settings (2a). Everything saves as it changes.
const SettingsPage = () => {
  const { profile, update, updateSettings, patch } = useProfile();
  const isDesktop = useIsDesktop();
  const isMobile = useIsMobile();
  const [name, setName] = useState(profile?.displayName ?? '');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const { track, note } = useSaveIndicator();

  // Fill the name in once the profile arrives
  useEffect(() => {
    setName(profile?.displayName ?? '');
  }, [profile?.displayName]);

  if (profile == null) return null;
  const myName = nameFor(profile.email, profile.displayName);
  const accent: Accent = isAccent(profile.settings.accent) ? profile.settings.accent : 'blurple';

  const saveName = () => {
    const trimmed = name.trim();
    if (trimmed === (profile.displayName ?? '')) return;
    void track(update({ displayName: trimmed || null }));
  };

  // Shown straight away; put back if the server refuses it
  const savePayments = (methods: PaymentMethod[], preferredId: string | null) => {
    const before = {
      paymentMethods: profile.paymentMethods,
      preferredPaymentMethodId: profile.preferredPaymentMethodId,
    };
    patch((p) => ({ ...p, paymentMethods: methods, preferredPaymentMethodId: preferredId }));
    track(api.setPaymentMethods(methods, preferredId)).catch((err) => {
      patch((p) => ({ ...p, ...before }));
      fail(err, 'Could not save your payment methods');
    });
    return Promise.resolve(true);
  };

  // The new picture shows from this device while it uploads
  const changeAvatar = async (file: File | null) => {
    if (file == null) return;
    setAvatarBusy(true);
    let preview: string | null = null;
    try {
      const photo = await shrinkImage(file, AVATAR.maxSide, AVATAR.maxBytes);
      preview = URL.createObjectURL(photo);
      const shown = preview;
      patch((p) => ({ ...p, avatarPreview: shown }));
      const { avatarVersion } = await track(api.setAvatar(photo));
      patch((p) => ({ ...p, avatarVersion }));
    } catch (err) {
      fail(err, 'Could not change your picture');
    } finally {
      // Keep showing the local copy until the uploaded one has loaded
      const shown = preview;
      if (shown) {
        setTimeout(() => {
          patch((p) => (p.avatarPreview === shown ? { ...p, avatarPreview: null } : p));
          URL.revokeObjectURL(shown);
        }, 3000);
      }
      setAvatarBusy(false);
    }
  };

  const removeAvatar = () => {
    const before = profile.avatarVersion;
    patch((p) => ({ ...p, avatarVersion: null, avatarPreview: null }));
    track(api.removeAvatar()).catch((err) => {
      patch((p) => ({ ...p, avatarVersion: before }));
      fail(err, 'Could not remove your picture');
    });
  };

  const pictureButtons = (
    <div className={classes.pictureButtons}>
      <FileButton
        onChange={changeAvatar}
        accept="image/*"
      >
        {(props) => (
          <UnstyledButton
            className={classes.textAction}
            disabled={avatarBusy}
            {...props}
          >
            {profile.avatarVersion ? 'Change picture' : 'Add picture'}
          </UnstyledButton>
        )}
      </FileButton>
      {(profile.avatarVersion || profile.avatarPreview) && (
        <UnstyledButton
          className={`${classes.textAction} ${classes.quiet}`}
          disabled={avatarBusy}
          onClick={removeAvatar}
        >
          Remove
        </UnstyledButton>
      )}
    </div>
  );

  const nameField = (
    <TextInput
      label="Display name"
      description={isMobile ? undefined : 'Shown to people in your splits instead of your email.'}
      placeholder={profile.email.split('@')[0]}
      value={name}
      maxLength={MAX_DISPLAY_NAME}
      onChange={(e) => setName(e.target.value)}
      onBlur={saveName}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );

  const themeField = (
    <div className={classes.field}>
      <div className={classes.fieldLabel}>Theme</div>
      <SegmentedControl
        className={isMobile ? undefined : classes.themeControl}
        fullWidth={isMobile}
        data={[
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' },
          { value: 'auto', label: isMobile ? 'Device' : 'Match device' },
        ]}
        value={profile.settings.theme}
        onChange={(theme) => track(updateSettings({ theme: theme as ThemeSetting }))}
      />
    </div>
  );

  const accentField = (
    <div className={classes.field}>
      <div className={classes.fieldLabel}>Accent colour · {ACCENTS[accent].label}</div>
      <div
        className={classes.swatches}
        role="radiogroup"
        aria-label="Accent colour"
      >
        {(Object.keys(ACCENTS) as Accent[]).map((key) => (
          <UnstyledButton
            key={key}
            role="radio"
            aria-checked={accent === key}
            aria-label={ACCENTS[key].label}
            title={ACCENTS[key].label}
            className={classes.swatch}
            data-selected={accent === key || undefined}
            style={{ '--swatch': ACCENTS[key].ramp[4] }}
            onClick={() => track(updateSettings({ accent: key }))}
          />
        ))}
      </div>
    </div>
  );

  const preferred = profile.paymentMethods.find((m) => m.id === profile.preferredPaymentMethodId);
  const orderedMethods = preferred
    ? [preferred, ...profile.paymentMethods.filter((m) => m !== preferred)]
    : profile.paymentMethods;

  const payments = (
    <PaymentMethods
      methods={profile.paymentMethods}
      preferredId={profile.preferredPaymentMethodId}
      onChange={savePayments}
      grouped={Boolean(isMobile)}
    />
  );

  if (!isDesktop) {
    return (
      <div className={classes.mobilePage}>
        <div className={classes.topBar}>
          <UnstyledButton
            className={classes.back}
            onClick={() => navigate('')}
            aria-label="Back to My splits"
          >
            <CaretLeft size={20} />
            <span>Settings</span>
          </UnstyledButton>
          {note}
        </div>

        <div className={classes.identity}>
          <div className={classes.avatarRing}>
            <UserAvatar
              name={myName}
              email={profile.email}
              avatarVersion={profile.avatarVersion}
              previewSrc={profile.avatarPreview}
              size={60}
            />
          </div>
          <div className={classes.identityName}>{myName}</div>
          <div className={classes.identityEmail}>{profile.email}</div>
          {pictureButtons}
        </div>

        {nameField}
        {themeField}
        {accentField}
        <div className={classes.field}>
          <div className={classes.fieldLabel}>Getting paid</div>
          {payments}
        </div>

        <Button
          variant="default"
          fullWidth
          size="md"
          className={`${classes.signOut} ${classes.signOutButton}`}
          onClick={signOut}
        >
          Sign out
        </Button>
      </div>
    );
  }

  return (
    <div className={classes.page}>
      <div className={classes.header}>
        <Title order={1}>Settings</Title>
        {note}
      </div>

      <div className={classes.columns}>
        <div className={classes.column}>
          <section className={classes.section}>
            <h2 className="sf-label">Profile</h2>
            <div className={classes.pictureRow}>
              <UserAvatar
                name={myName}
                email={profile.email}
                avatarVersion={profile.avatarVersion}
                previewSrc={profile.avatarPreview}
                size={44}
              />
              {pictureButtons}
            </div>
            <div className={classes.narrow}>{nameField}</div>
            <div className={classes.narrow}>
              <TextInput
                label="Email"
                value={profile.email}
                readOnly
                classNames={{ input: classes.readOnly }}
                rightSection={<LockSimple size={14} />}
              />
            </div>
          </section>

          <section className={classes.section}>
            <h2 className="sf-label">Getting paid</h2>
            <p className={classes.help}>
              Shown to people who owe you, next to their transfer in Settle up.
            </p>
            {payments}
            {orderedMethods.length > 0 && (
              <div className={classes.preview}>
                <div className={classes.previewLabel}>What someone who owes you sees</div>
                <PayHint
                  name={myName}
                  amountCents={10250}
                  currency={profile.settings.lastCurrency ?? 'MYR'}
                  methods={orderedMethods}
                />
              </div>
            )}
          </section>
        </div>

        <div className={classes.column}>
          <section className={classes.section}>
            <h2 className="sf-label">Appearance</h2>
            {themeField}
            {accentField}
            <div className={classes.appearancePreview}>
              <div className={classes.previewLabel}>Preview</div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className={classes.chip}>
                  <UserAvatar
                    name={myName}
                    email={profile.email}
                    avatarVersion={profile.avatarVersion}
                    previewSrc={profile.avatarPreview}
                    size={24}
                  />
                  {myName} <span className="sf-muted">(you)</span>
                  <span className="sf-positive sf-tabular">+140.10</span>
                </span>
                {/* Just a sample of the accent; it does nothing */}
                <Button
                  component="span"
                  size="compact-sm"
                  leftSection={<Plus size={14} />}
                  tabIndex={-1}
                  aria-hidden
                >
                  Add item
                </Button>
                <span className={classes.previewBadge}>1</span>
              </div>
              <div className={classes.previewBar}>
                <span>{myName}</span>
                <span className={classes.previewTrack}>
                  <span />
                </span>
                <span className="sf-positive sf-tabular">+140.10</span>
              </div>
            </div>
          </section>

          <section className={classes.section}>
            <h2 className="sf-label">Account</h2>
            <div>
              <Button
                variant="default"
                size="compact-md"
                leftSection={<SignOut size={16} />}
                className={classes.signOutButton}
                onClick={signOut}
              >
                Sign out
              </Button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
