import { ActionIcon, Tooltip, useComputedColorScheme } from '@mantine/core';
import { Moon, Sun } from '@phosphor-icons/react';
import { useProfile } from '../../profile/ProfileContext';

/**
 * Flips between light and dark in one tap. "Match device" stays in Settings; tapping
 * this picks the opposite of what's showing now.
 */
const ThemeToggle = ({ size = 30 }: { size?: number }) => {
  const { updateSettings } = useProfile();
  const scheme = useComputedColorScheme('dark', { getInitialValueInEffect: false });
  const next = scheme === 'dark' ? 'light' : 'dark';
  const label = next === 'light' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <Tooltip label={label}>
      <ActionIcon
        variant="subtle"
        color="gray"
        size={size}
        onClick={() => void updateSettings({ theme: next })}
        aria-label={label}
      >
        {next === 'light' ? <Sun size={18} /> : <Moon size={18} />}
      </ActionIcon>
    </Tooltip>
  );
};

export default ThemeToggle;
