// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { reloadMySplits } from '../my-splits/my-splits';
import { fakeServer, holdNext, renderApp, setupAppTests, splitDetail } from './app';

// Each screen test starts from nothing: work an earlier test left running (a reload of
// My splits after creating a split, say) finishes before the next test, rather than
// landing in it as that test's data

setupAppTests();

describe('screen tests, one after another', () => {
  test('one ends while My splits is still being reloaded', async () => {
    const server = fakeServer({ ...splitDetail('bali'), name: 'Bali' });
    renderApp(server, '/', { size: 'phone' });
    await screen.findByText('Bali', {}, { timeout: 3000 });
    // The server answers the reload only once this test has finished
    const reload = holdNext(server, 'GET', '/api/splits');
    void reloadMySplits();
    setTimeout(() => reload.release(), 0);
  });

  test('the next shows its own splits, not the ones left from before', async () => {
    renderApp(fakeServer({ ...splitDetail('trip'), name: 'Trip' }), '/', { size: 'phone' });
    expect(await screen.findByText('Trip', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByText('Bali')).toBeNull();
  });
});
