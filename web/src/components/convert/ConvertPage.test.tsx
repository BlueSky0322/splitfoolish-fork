// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { fakeServer, renderApp, splitDetail, setupAppTests } from '../../testing/app';

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
    expect(await screen.findByText(/RM\s?90\.00/)).toBeTruthy();
  });

  test('says so when there is no rate', async () => {
    renderApp(fakeServer(), '/?convert');
    // After one retry
    expect(
      await screen.findByText("Couldn't get a rate right now", {}, { timeout: 3000 }),
    ).toBeTruthy();
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
    expect(within(form).getByRole<HTMLInputElement>('textbox', { name: 'Amount' }).value).toBe(
      '100',
    );
  });
});
