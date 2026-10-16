// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { fakeServer, holdNext, renderApp, splitDetail, setupAppTests } from '../../testing/app';

setupAppTests();

describe('Convert', () => {
  test('converts into your home currency at the fetched rate', async () => {
    const server = fakeServer(splitDetail('trip'));
    server.rates.set('USDMYR', 4.5);
    renderApp(server, '/?convert');
    const user = userEvent.setup();
    const amount = await screen.findByRole('textbox', { name: 'Amount' });
    await user.clear(amount);
    await user.type(amount, '20');
    // 20 US dollars, into ringgit
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'From' }).value).toBe('USD');
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'To' }).value).toBe('MYR');
    expect(await screen.findByText(/RM\s?90\.00/)).toBeTruthy();
  });

  test.each([
    ['on a computer', 'desktop'],
    ['on a phone', 'phone'],
  ] as const)(
    'clicking the amount %s selects it, so typing replaces it; a second click places the cursor',
    async (_where, size) => {
      const server = fakeServer(splitDetail('trip'));
      server.rates.set('USDMYR', 4.5);
      renderApp(server, '/?convert', { size });
      const user = userEvent.setup();
      const amount = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Amount' });
      expect(amount.value).toBe('100');

      await user.click(amount);
      expect([amount.selectionStart, amount.selectionEnd]).toEqual([0, 3]);
      await user.keyboard('20');
      expect(amount.value).toBe('20');

      // Already in it: clicking again doesn't select everything again
      await user.pointer({ keys: '[MouseLeft]', target: amount, offset: 1 });
      expect(amount.selectionStart).toBe(amount.selectionEnd);
    },
  );

  test('says so when there is no rate', async () => {
    renderApp(fakeServer(), '/?convert');
    // After one retry
    expect(await screen.findByText("Couldn't get a rate right now")).toBeTruthy();
  });

  test('adds the amount to a split as a new item, in the currency it was in', async () => {
    const server = fakeServer(splitDetail('trip'));
    server.rates.set('USDMYR', 4.5);
    renderApp(server, '/?convert');
    const user = userEvent.setup();
    await screen.findByText(/RM\s?450\.00/);
    const add = screen.getByRole<HTMLButtonElement>('button', { name: 'Add as item' });
    await waitFor(() => expect(add.disabled).toBe(false));
    await user.click(add);

    const form = await screen.findByRole('dialog', {}, { timeout: 3000 });
    expect(window.location.search).toMatch(/^\?s=trip/);
    // 100 US dollars, not 100 ringgit
    expect(within(form).getByRole<HTMLInputElement>('textbox', { name: 'Amount' }).value).toBe(
      '100',
    );
    expect(within(form).getByRole<HTMLInputElement>('textbox', { name: 'Currency' }).value).toBe(
      'USD',
    );
    expect(await within(form).findByText(/RM\s?450\.00/)).toBeTruthy();

    // Saved as paid in dollars, and worth 450 ringgit in the split
    await user.type(within(form).getByRole('textbox', { name: 'What it was for' }), 'Tickets');
    await user.click(within(form).getByRole('button', { name: /^(Add|Add item)$/ }));
    await waitFor(() =>
      expect(server.splits.get('trip')!.items.map((i) => i.name)).toEqual(['Tickets']),
    );
    expect(server.splits.get('trip')!.items[0]).toMatchObject({
      cost: 450,
      original: { currency: 'USD', amount: 100 },
    });
  });

  test('holds the place of the result until the rate arrives', async () => {
    const server = fakeServer(splitDetail('trip'));
    server.rates.set('USDMYR', 4.5);
    const held = holdNext(server, 'GET', '/api/rates');
    renderApp(server, '/?convert');

    expect(await screen.findByText('Getting the rate…')).toBeTruthy();
    // No dash standing in for an amount that's on its way
    expect(screen.queryByText('—')).toBeNull();

    held.release();
    expect(await screen.findByText(/RM\s?450\.00/)).toBeTruthy();
    expect(screen.queryByText('Getting the rate…')).toBeNull();
  });
});
