// @vitest-environment jsdom
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { fakeServer, item, renderApp, setupAppTests, splitDetail } from '../../testing/app';

// Any picture can be opened full size with a tap, even an avatar inside a row or chip
// that does something else when tapped; a zoomed picture can be dragged with the mouse

setupAppTests();

/** Trip, where Ryan (signed in) has a profile picture, and Ann paid for a taxi */
const trip = () => {
  const split = splitDetail('trip', [item({ id: 'taxi', name: 'Taxi', cost: 30, payerId: 'ann' })]);
  split.members[0].avatarVersion = 2;
  return split;
};

/** Opens Taxi's form, then Ryan's picture from the "who paid" choice in it */
async function openRyansPicture() {
  renderApp(fakeServer(trip()), '/?s=trip');
  const user = userEvent.setup();
  await user.click(await screen.findByText('Taxi'));
  const form = within(await screen.findByRole('dialog'));
  const ryan = form.getAllByRole('radio').find((r) => r.textContent?.includes('Ryan'))!;
  await user.click(within(ryan).getByRole('button', { name: "View Ryan's picture" }));
  return { ryan, user };
}

describe('pictures', () => {
  test('an avatar inside a choice opens its picture, without making the choice', async () => {
    const { ryan } = await openRyansPicture();
    expect(await screen.findByRole('img', { name: 'Photo' })).toBeTruthy();
    // Ann still paid
    expect(ryan.getAttribute('aria-checked')).toBe('false');
  });

  test('a zoomed picture can be dragged with the mouse, and letting go keeps it zoomed', async () => {
    const { user } = await openRyansPicture();
    const photo = await screen.findByRole('img', { name: 'Photo' });
    await user.click(photo);
    expect(photo.style.transform).toBe('translate(0px, 0px) scale(2.5)');

    fireEvent.mouseDown(photo, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 140, clientY: 120 });
    fireEvent.mouseUp(window);
    // The click that ends a drag doesn't zoom back out
    fireEvent.click(photo);
    expect(photo.style.transform).toBe('translate(40px, 20px) scale(2.5)');
  });
});
