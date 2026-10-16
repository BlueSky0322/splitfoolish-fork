// @vitest-environment jsdom
import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { SplitDetail } from '@shared/api';
import { navigate } from '../../hooks/useRoute';
import { setCacheUser, splitCacheKey, writeCache } from '../../offline/cache';
import {
  fakeServer,
  holdNext,
  item,
  liveSockets,
  renderApp,
  setupAppTests,
  splitDetail,
} from '../../testing/app';

// The split page fetches the split again whenever someone else saves a change. Answers
// can come back in a different order than they were asked for: only the newest one
// counts, and a copy kept on the device never replaces what the server said.

setupAppTests();

const withItem = (id: string, name: string) =>
  splitDetail(id, [item({ id: `${id}-item`, name, cost: 10 })]);

/** Changes what the server has, then has the open page hear that it changed */
async function someoneSaves(server: ReturnType<typeof fakeServer>, name: string) {
  server.splits.get('trip')!.items = [item({ id: 'trip-item', name, cost: 10 })];
  const held = holdNext(server, 'GET', '/api/splits/trip');
  act(() => liveSockets().at(-1)!.hear({ type: 'changed', by: 'someone-else' }));
  // Asked for, with the answer (the split as it is now) held back
  await waitFor(() => expect(server.held).toHaveLength(0));
  return held;
}

describe('loading a split', () => {
  test('an older answer arriving last does not replace a newer one', async () => {
    const server = fakeServer(withItem('trip', 'Initial'));
    renderApp(server, '/?s=trip');
    await screen.findByText('Initial');
    await waitFor(() => expect(liveSockets().at(-1)?.readyState).toBe(1));

    const earlier = await someoneSaves(server, 'Earlier');
    const latest = await someoneSaves(server, 'Latest');

    await act(async () => {
      latest.release();
      await Promise.resolve();
    });
    expect(await screen.findByText('Latest')).toBeTruthy();

    await act(async () => {
      earlier.release();
      await Promise.resolve();
    });
    // Give the late answer every chance to land
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(screen.getByText('Latest')).toBeTruthy();
    expect(screen.queryByText('Earlier')).toBeNull();
  });

  test('a copy kept on the device does not replace what the server said', async () => {
    await setCacheUser('ryan@example.com');
    await writeCache<SplitDetail>(splitCacheKey('trip'), withItem('trip', 'Kept'));
    renderApp(fakeServer(withItem('trip', 'From the server')), '/?s=trip');

    expect(await screen.findByText('From the server')).toBeTruthy();
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(screen.queryByText('Kept')).toBeNull();
  });

  test('a kept copy does not replace the server saying the split is gone', async () => {
    await setCacheUser('ryan@example.com');
    await writeCache<SplitDetail>(splitCacheKey('trip'), withItem('trip', 'Kept'));
    renderApp(fakeServer(), '/?s=trip');

    expect(await screen.findByText(/This split doesn't exist/)).toBeTruthy();
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(screen.queryByText('Kept')).toBeNull();
  });

  test('the answer for a split left behind does not show in the one opened next', async () => {
    const server = fakeServer(withItem('a', 'In A'), withItem('b', 'In B'));
    const slowA = holdNext(server, 'GET', '/api/splits/a');
    renderApp(server, '/?s=a');

    act(() => navigate('?s=b'));
    expect(await screen.findByText('In B')).toBeTruthy();

    await act(async () => {
      slowA.release();
      await Promise.resolve();
    });
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(screen.getByText('In B')).toBeTruthy();
    expect(screen.queryByText('In A')).toBeNull();
  });

  test.each([
    ['a phone keeps saying Saved', 'phone', /Saved · 1 item/],
    ['a computer says it is updating', 'desktop', /Updating · 1 item/],
  ] as const)('while a kept copy is fetched again, %s', async (_what, size, whileFetching) => {
    await setCacheUser('ryan@example.com');
    await writeCache<SplitDetail>(splitCacheKey('trip'), withItem('trip', 'Kept'));
    const server = fakeServer(withItem('trip', 'Kept'));
    const held = holdNext(server, 'GET', '/api/splits/trip');
    renderApp(server, '/?s=trip', { size });

    expect(await screen.findByText('Kept')).toBeTruthy();
    expect(await screen.findByText(whileFetching)).toBeTruthy();
    if (size === 'phone') expect(screen.queryByText(/Updating/)).toBeNull();

    await act(async () => {
      held.release();
      await Promise.resolve();
    });
    expect(await screen.findByText(/Saved · 1 item/)).toBeTruthy();
  });

  test.each([
    ['on a computer', 'desktop'],
    ['on a phone', 'phone'],
  ] as const)(
    'until the split arrives %s, placeholders hold its place instead of an empty split',
    async (_where, size) => {
      const server = fakeServer(withItem('trip', 'Dinner'));
      const held = holdNext(server, 'GET', '/api/splits/trip');
      renderApp(server, '/?s=trip', { size });

      expect(await screen.findByText('Loading the split')).toBeTruthy();
      // Not an empty split that then fills in
      expect(screen.queryByText(/Which one is you/)).toBeNull();
      expect(screen.queryByText('No items yet')).toBeNull();
      expect(screen.queryByText(/RM\s?0\.00/)).toBeNull();

      await act(async () => {
        held.release();
        await Promise.resolve();
      });
      expect(await screen.findByText('Dinner')).toBeTruthy();
      expect(screen.queryByText('Loading the split')).toBeNull();
    },
  );
});
