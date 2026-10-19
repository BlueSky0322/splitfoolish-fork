// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { fakeServer, item, renderApp, setupAppTests, splitDetail } from '../../testing/app';

// Keyboard shortcuts on a computer: "?" lists them; in a split, keys add an item, switch
// tabs, share, and pick items to move. None fire while typing in a field.

setupAppTests();

const trip = () =>
  splitDetail('trip', [
    item({ id: 'dinner', name: 'Dinner', cost: 90 }),
    item({ id: 'taxi', name: 'Taxi', cost: 30, payerId: 'ann' }),
  ]);

const selectedTab = () =>
  screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')?.textContent;

async function openTrip() {
  renderApp(fakeServer(trip()), '/?s=trip');
  const user = userEvent.setup();
  await screen.findByText('Taxi');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^Add item$/ }).hasAttribute('disabled')).toBe(false),
  );
  return user;
}

describe('keyboard shortcuts', () => {
  test('"?" lists them', async () => {
    const user = await openTrip();
    await user.keyboard('?');
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    const split = within(dialog).getByRole('region', { name: 'In a split' });
    expect(within(split).getByText('Add item').nextElementSibling?.textContent).toBe('N');
    const items = within(dialog).getByRole('region', { name: 'Items' });
    expect(within(items).getByText('Select all').nextElementSibling?.textContent).toBe('CtrlA');
    expect(within(dialog).getByText(/On a Mac, Ctrl is ⌘/)).toBeTruthy();
  });

  test('N adds an item, and its letters typed in a field stay letters', async () => {
    const user = await openTrip();
    expect(
      screen.getByRole('button', { name: /^Add item$/ }).getAttribute('aria-keyshortcuts'),
    ).toBe('N');
    await user.keyboard('n');
    const form = await screen.findByRole('dialog', { name: 'Add item' });
    await user.type(within(form).getByRole('textbox', { name: 'What it was for' }), 'snaps');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(form).getByRole('textbox', { name: 'What it was for' })).toHaveProperty(
      'value',
      'snaps',
    );
  });

  test('S shares', async () => {
    const user = await openTrip();
    await user.keyboard('s');
    expect(await screen.findByText(/Anyone with the link/)).toBeTruthy();
  });

  test('I and P switch tabs', async () => {
    const user = await openTrip();
    await user.keyboard('p');
    await waitFor(() => expect(selectedTab()).toMatch(/^Photos/));
    await user.keyboard('i');
    await waitFor(() => expect(selectedTab()).toMatch(/^Items/));
  });

  test('X picks items, Ctrl A picks them all, D moves them to a day', async () => {
    const user = await openTrip();
    await user.keyboard('x');
    const bar = await screen.findByRole('toolbar');
    expect(within(bar).getByText('Pick items')).toBeTruthy();
    await user.keyboard('{Control>}a{/Control}');
    expect(await within(bar).findByText('2 selected')).toBeTruthy();
    await user.keyboard('d');
    expect(await screen.findByRole('dialog', { name: 'Move 2 items to' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // X again stops picking
    await user.keyboard('x');
    await waitFor(() => expect(screen.queryByRole('toolbar')).toBeNull());
  });
});
