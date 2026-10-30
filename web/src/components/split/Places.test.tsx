// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { forgetQueuedPhotos } from '../../offline/photo-queue';
import { fakeServer, item, renderApp, setupAppTests, splitDetail } from '../../testing/app';

// Where items were paid for and photos taken: a new item takes where the phone is, a
// receipt's place or a Maps link's; searching for one and Use my current location; taking
// a place off; and an account that turned recording its location off is never asked.

setupAppTests();

// jsdom can't decode images: shrinking hands the photo back as it is
vi.mock('../../utils/image', async (original) => ({
  ...(await original<typeof import('../../utils/image')>()),
  shrinkImage: (file: Blob) => Promise.resolve(new Blob([file], { type: 'image/jpeg' })),
}));

/** Truz Tackles, Kuala Selangor */
const HERE = { latitude: 3.340171, longitude: 101.250502 };
const KEPT = { lat: 3.34017, lng: 101.2505, name: null };
const TRUZ = { lat: 3.34017, lng: 101.2505, name: 'Truz Tackles, Kuala Selangor' };

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
    expect(form.getByRole('button', { name: 'Use my current location' })).toBeTruthy();
  });

  test('Use my current location sets one (where OpenStreetMap has no name, its plus code), Remove location takes it off, and a refusal says why', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await user.click(await screen.findByText('Dinner'));
    const form = within(await screen.findByRole('dialog'));
    // An item being edited isn't given where the phone is by itself
    expect(asked).not.toHaveBeenCalled();
    await user.click(form.getByRole('button', { name: 'Use my current location' }));
    expect(await form.findByRole('link', { name: '6PM387R2+36' })).toBeTruthy();
    await user.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(server.splits.get('trip')!.items[0].place).toEqual(KEPT));

    await user.click(await screen.findByText('Dinner'));
    const again = within(await screen.findByRole('dialog'));
    await user.click(again.getByRole('button', { name: 'Remove location' }));
    // Without the browser's say-so, there's no position: it says how to allow it
    position = null;
    await user.click(again.getByRole('button', { name: 'Use my current location' }));
    expect(await again.findByText(/Couldn't get your location/)).toBeTruthy();
    await user.click(again.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(server.splits.get('trip')!.items[0].place).toBeNull());
  });

  test('a new item records where the phone is by itself; one searched for replaces it, near there first', async () => {
    const server = fakeServer(trip());
    server.placeNames.set('3.3402,101.2505', 'Jalan Kuala Selangor-Teluk Intan, Kuala Selangor');
    server.places.set('truz', [
      { ...TRUZ, address: 'Jalan Kuala Selangor-Teluk Intan, Selangor, Malaysia' },
      { lat: 40.67474, lng: -74.10932, name: 'True World Tackle, Bayonne', address: null },
    ]);
    renderApp(server, '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add item' }));
    const form = within(await screen.findByRole('dialog'));
    expect(
      await form.findByRole('link', { name: 'Jalan Kuala Selangor-Teluk Intan, Kuala Selangor' }),
    ).toBeTruthy();
    expect(asked).toHaveBeenCalledTimes(1);
    await user.type(form.getByRole('textbox', { name: 'Amount' }), '42');
    // Where the phone was isn't something typed in: closing doesn't ask to keep it
    await user.click(form.getByRole('button', { name: 'Remove location' }));

    // Suggestions as it's typed, asked near the phone, once the typing pauses
    await user.type(form.getByRole('textbox', { name: 'Search for a place' }), 'Truz');
    const places = within(form.getByRole('list', { name: 'Places' }));
    await user.click(await places.findByRole('button', { name: /^Truz Tackles, Kuala Selangor/ }));
    expect(server.placeSearches.map((s) => s.text)).toEqual(['Truz']);
    expect(server.placeSearches[0].near).toEqual({ lat: 3.3, lng: 101.3 });
    expect(form.getByRole('link', { name: 'Truz Tackles, Kuala Selangor' })).toBeTruthy();
    await user.type(form.getByRole('textbox', { name: 'What it was for' }), 'Bait');
    await user.click(form.getByRole('button', { name: /^(Add|Add item)$/ }));
    await waitFor(() =>
      expect(server.splits.get('trip')!.items.find((i) => i.name === 'Bait')?.place).toEqual(TRUZ),
    );
  });

  test("a search that finds nothing, or can't be asked, says so; Enter takes the best match", async () => {
    const server = fakeServer(trip());
    server.places.set('truz tackles', [{ ...TRUZ, address: null }]);
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await user.click(await screen.findByText('Dinner'));
    const form = within(await screen.findByRole('dialog'));
    const search = form.getByRole('textbox', { name: 'Search for a place' });
    // Near the split's latest place, none here: anywhere
    await user.type(search, 'Nowhere at all');
    expect(await form.findByText(/No places found/)).toBeTruthy();
    expect(server.placeSearches.at(-1)).toEqual({ text: 'Nowhere at all', near: null });
    server.placeSearchDown = true;
    await user.clear(search);
    await user.type(search, 'Somewhere');
    expect(await form.findByText(/Search isn't answering right now/)).toBeTruthy();
    server.placeSearchDown = false;
    await user.clear(search);
    await user.type(search, 'Truz Tackles');
    await form.findByRole('button', { name: /^Truz Tackles, Kuala Selangor/ });
    await user.type(search, '{Enter}');
    // Enter took the place rather than saving the item
    expect(form.getByRole('link', { name: 'Truz Tackles, Kuala Selangor' })).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  test('a Maps link pasted into the search is its exact place; a shared link that only names one searches for it', async () => {
    const server = fakeServer(trip());
    const PIN = 'https://goo.gl/maps/pin123';
    const SHARED = 'https://share.google/P2KCOX2QH6QhNjrIb';
    server.linkPreviews.set(PIN, {
      title: 'VRJ3+MG Bagan Datuk, Perak',
      address: null,
      detail: null,
      image: null,
      site: 'goo.gl',
      position: { lat: 3.88166, lng: 100.80379 },
    });
    server.linkPreviews.set(SHARED, {
      title: 'Kedai Kopi 168',
      address: null,
      detail: null,
      image: null,
      site: 'share.google',
      position: null,
    });
    server.places.set('kedai kopi 168', [
      { lat: 3.11872, lng: 101.62051, name: 'Kedai Kopi 168, Petaling Jaya', address: 'SS 2' },
    ]);
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await user.click(await screen.findByText('Dinner'));
    const form = within(await screen.findByRole('dialog'));
    const search = form.getByRole('textbox', { name: 'Search for a place' });
    await user.click(search);
    await user.paste(SHARED);
    expect(await form.findByText(/doesn't say exactly where Kedai Kopi 168 is/)).toBeTruthy();
    expect(
      await form.findByRole('button', { name: /^Kedai Kopi 168, Petaling Jaya/ }),
    ).toBeTruthy();
    expect(server.placeSearches.map((s) => s.text)).toEqual(['Kedai Kopi 168']);

    await user.clear(search);
    await user.paste(PIN);
    await user.click(
      await form.findByRole('button', { name: /^VRJ3\+MG Bagan Datuk, Perak\s*From the link/ }),
    );
    expect(form.getByRole('link', { name: 'VRJ3+MG Bagan Datuk, Perak' })).toBeTruthy();
    await user.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(server.splits.get('trip')!.items[0].place).toEqual({
        lat: 3.88166,
        lng: 100.80379,
        name: 'VRJ3+MG Bagan Datuk, Perak',
      }),
    );
  });

  test("a link that says where it points shows its map and plus code, before it's named or when it can't be", async () => {
    // The Worker has nothing to say about it (offline, say)
    const PIN = 'https://maps.google.com/?q=3.88166,100.80379&entry=gps';
    const server = fakeServer(
      splitDetail('trip', [item({ id: 'park', name: 'Parking', cost: 5, notes: `At ${PIN}` })]),
    );
    renderApp(server, '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    await user.click(await screen.findByText('Parking'));
    const sheet = within(await screen.findByRole('dialog'));
    const card = await sheet.findByRole('link', { name: '6PM2VRJ3+MG, on Google Maps' });
    expect([...card.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toContain(
      'https://tile.openstreetmap.org/16/51118/32060.png',
    );
    expect(sheet.getByRole('link', { name: '6PM2VRJ3+MG' }).getAttribute('href')).toBe(PIN);
  });

  test('with Record my location off, the phone is never asked, but a receipt or a Maps link still gives a place', async () => {
    const server = fakeServer(trip());
    const PIN = 'https://goo.gl/maps/pin123';
    server.linkPreviews.set(PIN, {
      title: 'VRJ3+MG Bagan Datuk, Perak',
      address: null,
      detail: null,
      image: null,
      site: 'goo.gl',
      position: { lat: 3.88166, lng: 100.80379 },
    });
    renderApp(server, '/?settings#places', { size: 'phone' });
    const user = userEvent.setup();
    const on = await screen.findByRole('switch', { name: /Record my location for new expenses/ });
    expect(on).toHaveProperty('checked', true);
    await user.click(on);
    await waitFor(() => expect(server.me.settings.recordLocation).toBe(false));

    cleanup();
    renderApp(server, '/?s=trip', { size: 'phone' });
    await user.click(await screen.findByRole('button', { name: 'Add item' }));
    const form = within(await screen.findByRole('dialog'));
    await user.type(form.getByRole('textbox', { name: 'Amount' }), '12');
    await user.type(form.getByRole('textbox', { name: 'What it was for' }), 'Parking');
    // A photo taken here that doesn't say where keeps no place
    await user.click(form.getByRole('button', { name: 'Add photo' }));
    await pickPhotos(user, await screen.findByRole('button', { name: /^Take photo/ }), [
      photo('ticket.jpg'),
    ]);
    // A Maps link in the notes gives the item its place, named as its card is
    await user.click(form.getByRole('textbox', { name: 'Notes' }));
    await user.paste(`Parked at ${PIN}`);
    // The location, opening in Maps (the link's own chip, under the notes, has the name too)
    await waitFor(() =>
      expect(
        form
          .getAllByRole('link', { name: 'VRJ3+MG Bagan Datuk, Perak' })
          .map((a) => a.getAttribute('title')),
      ).toEqual([PIN, 'Open in Maps']),
    );
    await user.click(form.getByRole('button', { name: /^(Add|Add item)$/ }));
    await waitFor(() =>
      expect(server.splits.get('trip')!.items.find((i) => i.name === 'Parking')?.place).toEqual({
        lat: 3.88166,
        lng: 100.80379,
        name: 'VRJ3+MG Bagan Datuk, Perak',
      }),
    );
    await waitFor(() => expect(server.uploads).toHaveLength(1));
    expect(server.uploads[0].place).toBeNull();
    expect(asked).not.toHaveBeenCalled();
  });
});
