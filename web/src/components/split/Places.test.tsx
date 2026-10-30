// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { forgetQueuedPhotos } from '../../offline/photo-queue';
import { fakeServer, item, renderApp, setupAppTests, splitDetail } from '../../testing/app';

// Where items were paid for and photos taken: a photo taken here keeps where the phone
// was, and a new item takes its receipt's place; Use my location and taking a place off;
// and an account that turned locations off keeps none and isn't asked.

setupAppTests();

// jsdom can't decode images: shrinking hands the photo back as it is
vi.mock('../../utils/image', async (original) => ({
  ...(await original<typeof import('../../utils/image')>()),
  shrinkImage: (file: Blob) => Promise.resolve(new Blob([file], { type: 'image/jpeg' })),
}));

/** Truz Tackles, Kuala Selangor */
const HERE = { latitude: 3.340171, longitude: 101.250502 };
const KEPT = { lat: 3.34017, lng: 101.2505, name: null };

/** The phone's position, as the browser hands it over; or a refusal */
let position: typeof HERE | null = HERE;
const asked = vi.fn();

beforeEach(() => {
  position = HERE;
  asked.mockClear();
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback, fail: PositionErrorCallback) => {
        asked();
        if (position) ok({ coords: position } as GeolocationPosition);
        else fail({ code: 1, message: 'denied' } as GeolocationPositionError);
      },
    },
  });
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:photo'), revokeObjectURL: vi.fn() });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (navigator as { geolocation?: unknown }).geolocation;
  forgetQueuedPhotos();
});

const photo = (name: string) => new File([`photo ${name}`], name, { type: 'image/jpeg' });

/** Picks files in the chooser a button opens */
async function pickPhotos(
  user: ReturnType<typeof userEvent.setup>,
  button: HTMLElement,
  files: File[],
) {
  const opened: HTMLInputElement[] = [];
  const opening = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
    this: HTMLInputElement,
  ) {
    opened.push(this);
  });
  await user.click(button);
  opening.mockRestore();
  await user.upload(opened[0], files);
}

const trip = () => splitDetail('trip', [item({ id: 'dinner', name: 'Dinner', cost: 80 })]);

describe('places', () => {
  test('a receipt taken with the camera keeps where the phone was, and its new item takes it, named', async () => {
    const server = fakeServer(trip());
    server.placeNames.set('3.3402,101.2505', 'Truz Tackles, Kuala Selangor');
    renderApp(server, '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add item' }));
    const form = within(await screen.findByRole('dialog'));
    await user.type(form.getByRole('textbox', { name: 'Amount' }), '42');
    await user.type(form.getByRole('textbox', { name: 'What it was for' }), 'Bait');
    await user.click(form.getByRole('button', { name: 'Add photo' }));
    await pickPhotos(user, await screen.findByRole('button', { name: /^Take photo/ }), [
      photo('receipt.jpg'),
    ]);
    // The item's location fills in from the photo, named by OpenStreetMap, opening in Maps
    const shown = await form.findByRole('link', { name: 'Truz Tackles, Kuala Selangor' });
    expect(shown.getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query=3.34017,101.2505',
    );
    await user.click(form.getByRole('button', { name: /^(Add|Add item)$/ }));

    await waitFor(() =>
      expect(server.splits.get('trip')!.items.find((i) => i.name === 'Bait')?.place).toEqual({
        ...KEPT,
        name: 'Truz Tackles, Kuala Selangor',
      }),
    );
    await waitFor(() => expect(server.uploads.map((u) => u.place)).toEqual([KEPT]));
    // The item says where on its sheet, with a small map of the spot
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(await screen.findByText('Bait'));
    const where = await screen.findByRole('link', {
      name: 'Truz Tackles, Kuala Selangor, open in Maps',
    });
    expect(within(where).getByText('© OpenStreetMap')).toBeTruthy();
    expect([...where.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toContain(
      'https://tile.openstreetmap.org/16/51200/32159.png',
    );
  });

  test('a photo from the library without a place keeps none, and the phone is not asked', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    await user.click(await screen.findByText('Dinner'));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Edit item' }),
    );
    // The form, once it has taken the sheet's place
    const form = within((await screen.findByRole('textbox', { name: 'Amount' })).closest('form')!);
    await user.click(form.getByRole('button', { name: 'Add photo' }));
    await pickPhotos(user, await screen.findByRole('button', { name: /^Choose from library/ }), [
      photo('old.jpg'),
    ]);
    await waitFor(() => expect(server.uploads).toHaveLength(1));
    expect(server.uploads[0].place).toBeNull();
    expect(asked).not.toHaveBeenCalled();
    expect(form.getByRole('button', { name: 'Use my location' })).toBeTruthy();
  });

  test('Use my location sets one (where OpenStreetMap has no name, its position as Google Maps writes it), Remove location takes it off, and a refusal says why', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await user.click(await screen.findByText('Dinner'));
    const form = within(await screen.findByRole('dialog'));
    await user.click(form.getByRole('button', { name: 'Use my location' }));
    expect(await form.findByRole('link', { name: `3°20'24.6"N 101°15'01.8"E` })).toBeTruthy();
    await user.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(server.splits.get('trip')!.items[0].place).toEqual(KEPT));

    await user.click(await screen.findByText('Dinner'));
    const again = within(await screen.findByRole('dialog'));
    await user.click(again.getByRole('button', { name: 'Remove location' }));
    // Without the browser's say-so, there's no position: it says how to allow it
    position = null;
    await user.click(again.getByRole('button', { name: 'Use my location' }));
    expect(await again.findByText(/Couldn't get your location/)).toBeTruthy();
    await user.click(again.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(server.splits.get('trip')!.items[0].place).toBeNull());
  });

  test('with Save locations off in Settings, a photo taken here keeps no place', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?settings#places', { size: 'phone' });
    const user = userEvent.setup();
    const on = await screen.findByRole('switch', { name: /Save where photos are taken/ });
    expect(on).toHaveProperty('checked', true);
    await user.click(on);
    await waitFor(() => expect(server.me.settings.savePlaces).toBe(false));

    cleanup();
    renderApp(server, '/?s=trip', { size: 'phone' });
    await user.click(await screen.findByText('Dinner'));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Edit item' }),
    );
    // The form, once it has taken the sheet's place
    const form = within((await screen.findByRole('textbox', { name: 'Amount' })).closest('form')!);
    await user.click(form.getByRole('button', { name: 'Add photo' }));
    await pickPhotos(user, await screen.findByRole('button', { name: /^Take photo/ }), [
      photo('receipt.jpg'),
    ]);
    await waitFor(() => expect(server.uploads).toHaveLength(1));
    expect(server.uploads[0].place).toBeNull();
    expect(asked).not.toHaveBeenCalled();
  });
});
