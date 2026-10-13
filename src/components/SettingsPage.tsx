import { Button, SegmentedControl, Title, UnstyledButton } from '@mantine/core';
import { CaretLeft, Check, SignOut } from '@phosphor-icons/react';
import { ThemeSetting } from '../api';
import { useIsDesktop } from '../hooks/useBreakpoints';
import { navigate } from '../hooks/useRoute';
import { useProfile } from '../profile/ProfileContext';
import { clearCache } from '../split-cache';
import { ACCENTS, Accent } from '../theme/accents';
import classes from './SettingsPage.module.css';

const THEMES: { value: ThemeSetting; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'auto', label: 'Match device' },
];

export async function signOut() {
  await clearCache();
  window.location.href = '/cdn-cgi/access/logout';
}

const SettingsPage = () => {
  const { profile, update } = useProfile();
  const isDesktop = useIsDesktop();

  return (
    <div className={classes.page}>
      {isDesktop ? (
        <Title order={2}>Settings</Title>
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
        </div>
      )}

      <section className={classes.section}>
        <h3 className={classes.heading}>Appearance</h3>
        <div className={classes.field}>
          <div className={classes.label}>Theme</div>
          <SegmentedControl
            fullWidth
            data={THEMES}
            value={profile?.theme ?? 'auto'}
            disabled={profile == null}
            onChange={(theme) => update({ theme: theme as ThemeSetting })}
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
              const selected = (profile?.accent ?? 'blurple') === key;
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
                  disabled={profile == null}
                  onClick={() => update({ accent: key })}
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

      <section className={classes.section}>
        <h3 className={classes.heading}>Account</h3>
        <div className="sf-muted text-sm">Signed in as {profile?.email}</div>
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
    </div>
  );
};

export default SettingsPage;
