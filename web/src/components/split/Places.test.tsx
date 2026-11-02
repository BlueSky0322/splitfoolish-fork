// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { forgetQueuedPhotos } from '../../offline/photo-queue';
import { fakeServer, item, renderApp, setupAppTests, splitDetail } from '../../testing/app';

// Where items were paid for and photos taken: an item takes a receipt's place (what the
// photo itself says) or a Maps link's; Use my current location; taking a place off. The
// phone is never asked where it is unless the person asks.

setupAppTests();

// jsdom can't decode images: shrinking hands the photo back as it is
vi.mock('../../utils/image', async (original) => ({
  ...(await original<typeof import('../../utils/image')>()),
  shrinkImage: (file: Blob) => Promise.resolve(new Blob([file], { type: 'image/jpeg' })),
}));

// A photo says where it was taken when its file is named for it ("gps-…"), as a camera
// writes it into the photo; others say nothing
vi.mock('../../utils/exif', () => ({
  photoPosition: (file: File) =>
    Promise.resolve(file.name.startsWith('gps') ? { lat: 3.340171, lng: 101.250502 } : null),
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
  test('a receipt that says where it was taken keeps its place, and its new item takes it, named; the phone is never asked', async () => {
    const server = fakeServer(trip());
    server.placeNames.set('3.3402,101.2505', 'Truz Tackles, Kuala Selangor');
    renderApp(server, '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add item' }));
    const form = within(await screen.findByRole('dialog'));
    await user.type(form.getByRole('textbox', { name: 'Amount' }), '42');
    await user.type(form.getByRole('textbox', { name: 'What it was for' }), 'Bait');
    await user.click(form.getByRole('button', { name: 'Add photo' }));
    await pickPhotos(user, await screen.findByRole('button', { name: /^Choose from library/ }), [
      photo('gps-receipt.jpg'),
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
    // The item says where on its sheet, opening in Maps
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(await screen.findByText('Bait'));
    const where = await screen.findByRole('link', {
      name: 'Truz Tackles, Kuala Selangor, open in Maps',
    });
    expect(where.getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query=3.34017,101.2505',
    );
    // No map is drawn: nothing is asked of OpenStreetMap's tiles
    expect(document.querySelector('img[src*="tile.openstreetmap.org"]')).toBeNull();
    expect(asked).not.toHaveBeenCalled();
  });

  test('a photo that says nothing of where, even one just taken, keeps no place, and the phone is not asked', async () => {
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
    await pickPhotos(user, await screen.findByRole('button', { name: /^Take photo/ }), [
      photo('just-taken.jpg'),
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

  test("a link that says where it points shows its plus code, before it's named or when it can't be", async () => {
    // The Worker has nothing to say about it (offline, say)
    const PIN = 'https://maps.google.com/?q=3.88166,100.80379&entry=gps';
    const server = fakeServer(
      splitDetail('trip', [item({ id: 'park', name: 'Parking', cost: 5, notes: `At ${PIN}` })]),
    );
    renderApp(server, '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    await user.click(await screen.findByText('Parking'));
    const sheet = within(await screen.findByRole('dialog'));
    const chip = await sheet.findByRole('link', { name: '6PM2VRJ3+MG' });
    expect(chip.getAttribute('href')).toBe(PIN);
    expect(chip.dataset.place).toBeDefined();
  });

  test('in the list, notes show a Maps link as its place with a pin and other links short, each opening, on a phone and desktop', async () => {
    const PIN = 'https://maps.app.goo.gl/y8F94Y1RPVDjz7ci8';
    const server = () => {
      const s = fakeServer(
        splitDetail('trip', [
          item({
            id: 'stay',
            name: 'Homestay',
            cost: 187,
            notes: `Here ${PIN}\nmenu https://example.com/menu`,
          }),
        ]),
      );
      s.linkPreviews.set(PIN, {
        title: 'VRP3+RQ Bagan Datuk, Perak',
        address: null,
        detail: null,
        image: null,
        site: 'maps.app.goo.gl',
        position: { lat: 3.88705, lng: 100.80439 },
      });
      return s;
    };
    for (const size of ['phone', 'desktop'] as const) {
      cleanup();
      renderApp(server(), '/?s=trip', { size });
      const name = await screen.findByText('Homestay');
      const row = name.closest<HTMLElement>('[role="listitem"]')!;
      await waitFor(() =>
        expect(row.textContent).toContain(
          'Here VRP3+RQ Bagan Datuk, Perak · menu example.com/menu',
        ),
      );
      // Each opens where it goes, over the row that opens the item
      const place = within(row).getByRole('link', { name: 'VRP3+RQ Bagan Datuk, Perak' });
      expect(place.getAttribute('href')).toBe(PIN);
      expect(place.getAttribute('target')).toBe('_blank');
      expect(place.querySelector('svg')).toBeTruthy();
      expect(within(row).getByRole('link', { name: 'example.com/menu' }).getAttribute('href')).toBe(
        'https://example.com/menu',
      );
      // and the row itself still opens it: its name's button reaches across it
      expect(within(row).getByRole('button', { name: 'Homestay' })).toBeTruthy();
    }
  });

  test('a new item is never given where the phone is by itself, but a Maps link in its notes gives it a place', async () => {
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
    renderApp(server, '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add item' }));
    const form = within(await screen.findByRole('dialog'));
    await user.type(form.getByRole('textbox', { name: 'Amount' }), '12');
    await user.type(form.getByRole('textbox', { name: 'What it was for' }), 'Parking');
    // A photo taken here that doesn't say where keeps none
    await user.click(form.getByRole('button', { name: 'Add photo' }));
    await pickPhotos(user, await screen.findByRole('button', { name: /^Take photo/ }), [
      photo('ticket.jpg'),
    ]);
    // Nothing was asked of the phone as the item was started
    expect(form.getByRole('button', { name: 'Use my current location' })).toBeTruthy();
    // A Maps link in the notes gives the item its place, named as the Worker names it
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
