// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { dayKey, dayLabel } from '../../split/grouping';
import { fakeServer, item, renderApp, setupAppTests, splitDetail } from '../../testing/app';

// Adding an item straight to a day from that day's heading: the form opens with the
// day set and still changeable, and the item is saved on that day at the time it is now

setupAppTests();

const OCT_8 = Date.UTC(2026, 9, 8, 9);
const OCT_10 = Date.UTC(2026, 9, 10, 12);

const trip = () =>
  splitDetail('trip', [
    item({ id: 'dinner', name: 'Dinner', cost: 90, createdAt: OCT_10 }),
    item({ id: 'taxi', name: 'Taxi', cost: 30, createdAt: OCT_8 }),
  ]);

/** Adds Snacks for 16 in the open Add item form */
async function addSnacks(user: ReturnType<typeof userEvent.setup>, form: HTMLElement) {
  await user.type(within(form).getByRole('textbox', { name: 'What it was for' }), 'Snacks');
  await user.type(within(form).getByRole('textbox', { name: 'Amount' }), '16');
  await user.click(within(form).getByRole('button', { name: /^(Add|Add item)$/ }));
}

const savedSnacks = async (server: ReturnType<typeof fakeServer>) => {
  await waitFor(() =>
    expect(server.splits.get('trip')!.items.some((i) => i.name === 'Snacks')).toBe(true),
  );
  return server.splits.get('trip')!.items.find((i) => i.name === 'Snacks')!;
};

describe('adding to a day', () => {
  test("on a computer, a day's heading adds an item on that day", async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await screen.findByText('Taxi');
    await user.click(screen.getByRole('button', { name: `Add to ${dayLabel(OCT_8)}` }));

    const form = await screen.findByRole('dialog', { name: 'Add item' });
    expect(within(form).getByText('From the day you picked')).toBeTruthy();
    expect(within(form).getByLabelText(/^Date/)).toHaveProperty('value', dayKey(OCT_8));
    await addSnacks(user, form);

    const snacks = await savedSnacks(server);
    expect(dayKey(snacks.createdAt)).toBe(dayKey(OCT_8));
    // Shown under that day, beside Taxi
    const day = screen.getByRole('button', { name: `Add to ${dayLabel(OCT_8)}` }).parentElement!
      .parentElement!;
    expect(within(day).getByText('Snacks')).toBeTruthy();
    expect(within(day).getByText('Taxi')).toBeTruthy();
  });

  test('the day can still be changed, and the page button adds on today', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await screen.findByText('Taxi');
    await user.click(screen.getByRole('button', { name: `Add to ${dayLabel(OCT_10)}` }));
    const form = await screen.findByRole('dialog', { name: 'Add item' });
    fireEvent.change(within(form).getByLabelText(/^Date/), { target: { value: dayKey(OCT_8) } });
    await addSnacks(user, form);
    expect(dayKey((await savedSnacks(server)).createdAt)).toBe(dayKey(OCT_8));

    // From the page's Add item button the date is today, without the tag
    await user.click(screen.getByRole('button', { name: /^Add item$/ }));
    const plain = await screen.findByRole('dialog', { name: 'Add item' });
    expect(within(plain).getByLabelText(/^Date/)).toHaveProperty('value', dayKey(Date.now()));
    expect(within(plain).queryByText('From the day you picked')).toBeNull();
  });

  test('a day that has not come yet is refused', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await screen.findByText('Taxi');
    await user.click(screen.getByRole('button', { name: `Add to ${dayLabel(OCT_8)}` }));
    const form = await screen.findByRole('dialog', { name: 'Add item' });
    fireEvent.change(within(form).getByLabelText(/^Date/), { target: { value: '2999-01-01' } });
    await addSnacks(user, form);
    // The date field's own limit stops it, before the form's check
    const date = within(form).getByLabelText<HTMLInputElement>(/^Date/);
    expect(date.validity.rangeOverflow).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getByRole('dialog', { name: 'Add item' })).toBeTruthy();
    expect(server.splits.get('trip')!.items.some((i) => i.name === 'Snacks')).toBe(false);
  });

  test('the headings stop offering it while items are being picked', async () => {
    renderApp(fakeServer(trip()), '/?s=trip');
    const user = userEvent.setup();
    await screen.findByText('Taxi');
    expect(screen.getAllByRole('button', { name: /^Add to / })).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Select' }));
    expect(screen.queryByRole('button', { name: /^Add to / })).toBeNull();
  });

  test('on a phone, each day has its own add button', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    await screen.findByText('Taxi');
    await user.click(screen.getByRole('button', { name: `Add to ${dayLabel(OCT_8)}` }));
    const form = await screen.findByRole('dialog', { name: /Add item/ });
    await addSnacks(user, form);
    expect(dayKey((await savedSnacks(server)).createdAt)).toBe(dayKey(OCT_8));
  });
});

describe('the date in the item form', () => {
  test('a new item can go on yesterday with a tap', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await screen.findByText('Taxi');
    await user.click(screen.getByRole('button', { name: /^Add item$/ }));
    const form = await screen.findByRole('dialog', { name: 'Add item' });
    await user.click(within(form).getByRole('button', { name: 'Yesterday' }));
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
    expect(within(form).getByLabelText(/^Date/)).toHaveProperty('value', dayKey(yesterday));
    await addSnacks(user, form);
    expect(dayKey((await savedSnacks(server)).createdAt)).toBe(dayKey(yesterday));
  });

  test('editing an item moves it to another day, keeping its time of day', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await user.click(await screen.findByText('Taxi'));
    const form = await screen.findByRole('dialog', { name: 'Edit item' });
    expect(within(form).getByLabelText(/^Date/)).toHaveProperty('value', dayKey(OCT_8));
    expect(within(form).queryByText('It keeps its time of day.')).toBeNull();
    fireEvent.change(within(form).getByLabelText(/^Date/), { target: { value: dayKey(OCT_10) } });
    expect(within(form).getByText('It keeps its time of day.')).toBeTruthy();
    await user.click(within(form).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const taxi = server.splits.get('trip')!.items.find((i) => i.id === 'taxi')!;
      expect(dayKey(taxi.createdAt)).toBe(dayKey(OCT_10));
    });
    const taxi = server.splits.get('trip')!.items.find((i) => i.id === 'taxi')!;
    expect(new Date(taxi.createdAt).getHours()).toBe(new Date(OCT_8).getHours());
    expect(new Date(taxi.createdAt).getMinutes()).toBe(new Date(OCT_8).getMinutes());
  });
});
