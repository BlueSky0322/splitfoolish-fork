// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { fakeServer, item, renderApp, setupAppTests, splitDetail } from '../../testing/app';

setupAppTests();

const trip = () => splitDetail('trip', [item({ id: 'dinner', name: 'Dinner', cost: 90 })]);

describe("resetting a split's share link", () => {
  test('asks in the share dialog itself, which stays open, and shows the new link', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await screen.findByText('Dinner');
    await user.click(screen.getByRole('button', { name: 'Share' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/join=token$/)).toBeTruthy();

    // Asked, then thought better of it: nothing changes
    await user.click(within(dialog).getByRole('button', { name: 'Reset link' }));
    const ask = within(dialog).getByRole('group', { name: 'Reset the share link?' });
    expect(ask.textContent).toContain('The current link stops working');
    await user.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(within(dialog).queryByRole('group')).toBeNull();
    expect(server.splits.get('trip')!.shareToken).toBe('token');

    await user.click(within(dialog).getByRole('button', { name: 'Reset link' }));
    await user.click(
      within(within(dialog).getByRole('group')).getByRole('button', { name: 'Reset link' }),
    );
    expect(await within(dialog).findByText(/join=token-new$/)).toBeTruthy();
    expect(within(dialog).getByRole('status').textContent).toBe(
      'New link ready. The old one no longer works.',
    );
    expect(within(dialog).queryByRole('group')).toBeNull();
    // The same dialog all along: never swapped for another
    expect(screen.getAllByRole('dialog')).toEqual([dialog]);
    expect(dialog.isConnected).toBe(true);
  });

  test('on a phone, asks under the link buttons in the same sheet', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    await screen.findByText('Dinner');
    await user.click(screen.getByRole('button', { name: 'Share split' }));
    const sheet = await screen.findByRole('dialog');

    await user.click(within(sheet).getByRole('button', { name: 'Reset' }));
    const ask = within(sheet).getByRole('group', { name: 'Reset the share link?' });
    await user.click(within(ask).getByRole('button', { name: 'Reset link' }));
    await waitFor(() => expect(server.splits.get('trip')!.shareToken).toBe('token-new'));
    expect(await within(sheet).findByRole('status')).toBeTruthy();
    expect(screen.getAllByRole('dialog')).toEqual([sheet]);
  });
});
