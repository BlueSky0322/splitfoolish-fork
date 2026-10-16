// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import type { ItemOriginal } from '@shared/types';
import { fakeServer, item, renderApp, setupAppTests, splitDetail } from '../../testing/app';

// The Currencies sheet: each other currency items were paid in, the rate they're on,
// and whether that's a live rate (refreshed) or one someone typed (kept as typed)

setupAppTests();

const paidIn = (original: ItemOriginal) =>
  splitDetail('trip', [item({ id: 'ramen', name: 'Ramen', cost: 30, original })]);

async function openCurrencies(original: ItemOriginal) {
  renderApp(fakeServer(paidIn(original)), '/?s=trip');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: '1 other currencies' }));
  return within(await screen.findByRole('dialog'));
}

describe('the Currencies sheet', () => {
  test('a live rate says where it came from, can be refreshed, and can be swapped for your own', async () => {
    const sheet = await openCurrencies({
      currency: 'JPY',
      amount: 1000,
      rate: 0.03,
      rateSource: 'wise',
      rateAt: Date.now(),
    });
    expect(sheet.getByText(/^Wise, /)).toBeTruthy();
    expect(sheet.getByRole('button', { name: /Refresh/ })).toBeTruthy();
    expect(sheet.getByRole('button', { name: 'Use my own rate' })).toBeTruthy();
  });

  test('a rate saved without a source by an older build is shown as typed, and not refreshed', async () => {
    const sheet = await openCurrencies({ currency: 'JPY', amount: 1000, rate: 0.03, rateAt: 1 });
    expect(sheet.getByText('Your rate')).toBeTruthy();
    expect(sheet.getByRole('button', { name: 'Use live rate' })).toBeTruthy();
    expect(sheet.queryByRole('button', { name: /Refresh/ })).toBeNull();
  });
});
