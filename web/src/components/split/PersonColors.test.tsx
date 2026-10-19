// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { fakeServer, item, renderApp, setupAppTests, splitDetail } from '../../testing/app';
import { personColor, personColors, personTextColor } from '../../split/person-colors';

// Each person in a split has a colour of their own, filling their avatar and colouring
// their name, so people are easier to tell apart

setupAppTests();

const trip = () =>
  splitDetail('trip', [
    item({ id: 'dinner', name: 'Dinner', cost: 90 }),
    item({ id: 'taxi', name: 'Taxi', cost: 30, payerId: 'ann' }),
  ]);

/** The split's colour for each of Ryan and Ann, as CSS */
const expected = () => {
  const colors = personColors('trip', trip().people);
  return { ryan: personColor(colors.get('me')!), ann: personColor(colors.get('ann')!) };
};

/** The fill of every avatar showing this initial on the split's page */
const avatarFills = (initial: string) =>
  within(screen.getByRole('main'))
    .getAllByText(initial, { exact: true })
    .map((el) => el.closest<HTMLElement>('.mantine-Avatar-placeholder')?.style.background)
    .filter((fill) => fill != null);

describe("people's colours", () => {
  test('each person shows in a colour of their own, the same wherever they appear', async () => {
    renderApp(fakeServer(trip()), '/?s=trip');
    await screen.findByText('Taxi');
    const { ryan, ann } = expected();
    expect(ryan).not.toBe(ann);
    expect(avatarFills('R').length).toBeGreaterThan(1);
    expect(new Set(avatarFills('R'))).toEqual(new Set([ryan]));
    expect(new Set(avatarFills('A'))).toEqual(new Set([ann]));
    // Your own account, outside the split, keeps the plain avatar
    const yours = within(screen.getAllByRole('navigation')[0])
      .queryAllByText('R', { exact: true })
      .map((el) => el.closest<HTMLElement>('.mantine-Avatar-placeholder')?.style.background);
    expect(yours.length).toBeGreaterThan(0);
    expect(yours.every((fill) => fill === 'var(--sf-avatar)')).toBe(true);
  });

  test("a person's name is in their colour, wherever it is written", async () => {
    renderApp(fakeServer(trip()), '/?s=trip');
    await screen.findByText('Taxi');
    const colors = personColors('trip', trip().people);
    const ann = personTextColor(colors.get('ann')!);
    const named = within(screen.getByRole('main')).getAllByText('Ann', { exact: true });
    // The people in the header, the payer of Taxi, and the balances at least
    expect(named.length).toBeGreaterThanOrEqual(3);
    expect(new Set(named.map((el) => el.style.color))).toEqual(new Set([ann]));
  });

  test('an account in the sharing list shows in the colour of the person it is', async () => {
    renderApp(fakeServer(trip()), '/?s=trip');
    const user = userEvent.setup();
    await screen.findByText('Taxi');
    await user.click(screen.getByRole('button', { name: 'Share' }));
    const dialog = within(await screen.findByRole('dialog'));
    const fill = dialog
      .getByText('R', { exact: true })
      .closest<HTMLElement>('.mantine-Avatar-placeholder')?.style.background;
    expect(fill).toBe(expected().ryan);
  });
});
