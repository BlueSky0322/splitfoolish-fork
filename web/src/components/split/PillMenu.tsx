import { Menu, UnstyledButton } from '@mantine/core';
import { CaretDown, Check } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import page from './Split.module.css';

export interface PillOption {
  key: string;
  label: string;
  icon?: ReactNode;
  /** How many there are of it, shown after its name */
  count?: number;
}

/**
 * A phone toolbar's pill that shows the choice made, and opens a menu of every choice,
 * with the one in use ticked, so any of them is one tap away
 */
const PillMenu = ({
  title,
  label,
  icon,
  options,
  value,
  onChange,
}: {
  /** What the choice is about, heading the menu ("Sort by") */
  title: string;
  /** What the pill is called for screen readers, with the choice made */
  label: string;
  icon: ReactNode;
  options: PillOption[];
  value: string;
  onChange: (key: string) => void;
}) => {
  const chosen = options.find((o) => o.key === value) ?? options[0];
  return (
    <Menu position="bottom-start">
      <Menu.Target>
        <UnstyledButton
          className={page.pill}
          aria-label={label}
        >
          {icon}
          <span className={page.pillLabel}>{chosen.label}</span>
          {chosen.count != null && <span className="sf-muted">{chosen.count}</span>}
          <CaretDown size={10} />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{title}</Menu.Label>
        {options.map((option) => (
          <Menu.Item
            key={option.key}
            leftSection={option.icon}
            onClick={() => onChange(option.key)}
            color={option.key === chosen.key ? 'accent' : undefined}
            rightSection={option.key === chosen.key ? <Check size={14} /> : null}
          >
            {option.label}
            {option.count != null && (
              <>
                {' '}
                <span className="sf-muted">{option.count}</span>
              </>
            )}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
};

export default PillMenu;
