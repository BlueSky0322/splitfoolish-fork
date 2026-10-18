// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import type { ItemOriginal } from '@shared/types';
import { fakeServer, item, renderApp, setupAppTests, splitDetail } from '../../testing/app';
import { formatMoney } from '../../utils/money';

// Items paid in other currencies: each is converted at the rate on the day it was paid.
// The Currencies sheet shows the rates in use, which never refresh, and lets a typed rate
// stand in for them; the item form previews the rate for the item's own day.

setupAppTests();

/** Noon UTC on a day in October 2026, and that day as rates are named */
const oct = (day: number) => Date.UTC(2026, 9, day, 12);
const dayName = (day: number) => `2026-10-${String(day).padStart(2, '0')}`;

const paidIn = (...originals: [ItemOriginal, number?][]) =>
  splitDetail(
    'trip',
    originals.map(([original, createdAt], i) =>
      item({ id: `i${i}`, name: `Ramen ${i + 1}`, cost: 30, original, createdAt }),
    ),
  );

async function openCurrencies(...originals: [ItemOriginal, number?][]) {
  const server = fakeServer(paidIn(...originals));
  renderApp(server, '/?s=trip');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: '1 other currencies' }));
  return { sheet: within(await screen.findByRole('dialog')), user, server };
}

describe('the Currencies sheet', () => {
  test("a fetched rate says where it came from and which day, isn't refreshed, and can be swapped for your own", async () => {
    const { sheet } = await openCurrencies([
      { currency: 'JPY', amount: 1000, rate: 0.03, rateSource: 'wise', rateAt: Date.now() },
    ]);
    expect(sheet.getByText('Wise, today')).toBeTruthy();
    expect(sheet.getByText('1 JPY = 0.03 MYR')).toBeTruthy();
    expect(sheet.queryByRole('button', { name: /Refresh/ })).toBeNull();
    expect(sheet.getByRole('button', { name: 'Use my own rate' })).toBeTruthy();
  });

  test('items paid on different days show the newest rate as the newest', async () => {
    const { sheet } = await openCurrencies(
      [{ currency: 'JPY', amount: 1000, rate: 0.03, rateSource: 'frankfurter', rateAt: oct(9) }],
      [{ currency: 'JPY', amount: 500, rate: 0.031, rateSource: 'frankfurter', rateAt: oct(12) }],
    );
    expect(sheet.getByText('Newest: 1 JPY = 0.031 MYR')).toBeTruthy();
    const shown = new Date(oct(12)).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
    });
    expect(sheet.getByText(`ECB, ${shown}`)).toBeTruthy();
    expect(sheet.getByText('2 items')).toBeTruthy();
  });

  test('a typed rate goes back to the rate on the day each item was paid', async () => {
    // Saved without a source by an older build, so typed
    const { sheet, user, server } = await openCurrencies(
      [{ currency: 'JPY', amount: 1000, rate: 0.05, rateAt: 1 }, oct(9)],
      [{ currency: 'JPY', amount: 1000, rate: 0.05, rateAt: 1 }, oct(12)],
    );
    expect(sheet.getByText('Your rate')).toBeTruthy();
    server.rates.set(`JPYMYR@${dayName(9)}`, 0.03);
    server.rates.set(`JPYMYR@${dayName(12)}`, 0.031);
    await user.click(sheet.getByRole('button', { name: "Use each day's rate" }));

    expect(await sheet.findByText('Newest: 1 JPY = 0.031 MYR')).toBeTruthy();
    expect(server.sent.at(-1)?.changes).toEqual([{ op: 'setRate', currency: 'JPY', rate: null }]);
    expect(server.splits.get('trip')!.items.map((i) => i.cost)).toEqual([30, 31]);
  });
});

describe('the item form, for an item paid in another currency', () => {
  test("previews a new amount at the rate on the day the item was paid, not today's", async () => {
    const server = fakeServer(
      paidIn([{ currency: 'JPY', amount: 1000, rate: 0.03, rateSource: 'frankfurter' }, oct(9)]),
    );
    server.rates.set('JPYMYR', 0.04);
    server.rates.set(`JPYMYR@${dayName(9)}`, 0.03);
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await user.click(await screen.findByText('Ramen 1'));
    const form = within(await screen.findByRole('dialog'));
    const amount = form.getByRole('textbox', { name: 'Amount' });
    await user.clear(amount);
    await user.type(amount, '2000');

    expect(await form.findByText(`≈ ${formatMoney(6000, 'MYR')}`)).toBeTruthy();
    await user.click(form.getByRole('button', { name: 'Use my own rate' }));
    expect(form.getByRole('button', { name: "Use that day's rate" })).toBeTruthy();
  });
});
