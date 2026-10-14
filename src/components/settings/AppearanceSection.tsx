import { Button, UnstyledButton } from '@mantine/core';
import { CheckCircle, Plus } from '@phosphor-icons/react';
import { CSSProperties } from 'react';
import { ThemeSetting } from '../../api';
import { useProfile } from '../../profile/ProfileContext';
import { ACCENTS, Accent, isAccent } from '../../theme/accents';
import SettingsCard from './SettingsCard';
import type { Track } from './useSaveIndicator';
import classes from './SettingsLayout.module.css';

const THEMES: { value: ThemeSetting; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'auto', label: 'Match device' },
];

// Appearance (9d): theme as small previews, and the accent colour with a sample of it
const AppearanceSection = ({ track }: { track: Track }) => {
  const { profile, updateSettings } = useProfile();
  if (profile == null) return null;
  const theme = profile.settings.theme;
  const accent: Accent = isAccent(profile.settings.accent) ? profile.settings.accent : 'blurple';

  return (
    <>
      <SettingsCard title="Theme">
        <div
          className={classes.themeTiles}
          role="radiogroup"
          aria-label="Theme"
        >
          {THEMES.map((t) => (
            <UnstyledButton
              key={t.value}
              role="radio"
              aria-checked={theme === t.value}
              className={classes.themeOption}
              data-selected={theme === t.value || undefined}
              onClick={() => theme !== t.value && track(updateSettings({ theme: t.value }))}
            >
              {/* A sketch of the app in that theme */}
              <span
                className={classes.themeTile}
                data-theme-tile={t.value}
                aria-hidden
              >
                <span className={classes.tileBar} />
                <span className={classes.tileBarShort} />
                <span className={classes.tileButton} />
              </span>
              <span className={classes.themeLabel}>
                {theme === t.value && (
                  <CheckCircle
                    size={16}
                    weight="fill"
                  />
                )}
                {t.label}
              </span>
            </UnstyledButton>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard
        title="Accent colour"
        help="Used for buttons, links and highlights."
      >
        <div
          className={classes.accentSwatches}
          role="radiogroup"
          aria-label="Accent colour"
        >
          {(Object.keys(ACCENTS) as Accent[]).map((key) => (
            <UnstyledButton
              key={key}
              role="radio"
              aria-checked={accent === key}
              className={classes.accentOption}
              data-selected={accent === key || undefined}
              onClick={() => accent !== key && track(updateSettings({ accent: key }))}
            >
              <span
                className={classes.accentSwatch}
                style={{ '--swatch': ACCENTS[key].ramp[4] } as CSSProperties}
              />
              <span className={classes.accentName}>{ACCENTS[key].label}</span>
            </UnstyledButton>
          ))}
        </div>
        {/* A sample of the accent; none of it does anything */}
        <div
          className={classes.accentPreview}
          aria-hidden
        >
          <span className="sf-muted text-xs">Preview</span>
          <span className="flex-1" />
          <span className={classes.previewLink}>Split settings</span>
          <span className={classes.accentTag}>MYR</span>
          <Button
            component="span"
            size="compact-sm"
            leftSection={<Plus size={14} />}
            tabIndex={-1}
          >
            Add item
          </Button>
        </div>
      </SettingsCard>
    </>
  );
};

export default AppearanceSection;
