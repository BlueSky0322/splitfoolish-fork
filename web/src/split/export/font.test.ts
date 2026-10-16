import { afterEach, describe, expect, test, vi } from 'vitest';

// The PDF's font: fetched once a visit, and only ever a real TrueType font

/** The font module afresh, since it keeps the font once fetched */
async function fontModule(...answers: Response[]) {
  const fetch = vi.fn(() => Promise.resolve(answers.shift()!));
  vi.stubGlobal('fetch', fetch);
  vi.resetModules();
  return { fetch, ...(await import('./font')) };
}

const TRUE_TYPE = new Uint8Array([0, 1, 0, 0, 0, 12, 0, 128]);
const font = () => new Response(TRUE_TYPE, { headers: { 'Content-Type': 'font/ttf' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loading the PDF font', () => {
  test('fetches it once, as base64', async () => {
    const { fetch, loadFont, FONT_URL } = await fontModule(font());
    expect(await loadFont()).toBe('AAEAAAAMAIA=');
    expect(await loadFont()).toBe('AAEAAAAMAIA=');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(FONT_URL);
  });

  test('refuses a page sent in its place, and fetches it again next time', async () => {
    const page = new Response('<!doctype html><html></html>', {
      headers: { 'Content-Type': 'text/html' },
    });
    const { fetch, loadFont } = await fontModule(page, font());
    await expect(loadFont()).rejects.toThrow("Couldn't load the PDF font");
    expect(await loadFont()).toBe('AAEAAAAMAIA=');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('says when the server turns it away', async () => {
    const { loadFont } = await fontModule(new Response('Not found', { status: 404 }));
    await expect(loadFont()).rejects.toThrow("Couldn't load the PDF font (404)");
  });
});
