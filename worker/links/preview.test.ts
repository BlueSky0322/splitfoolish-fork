import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMapsLink, positionInLink } from '../../shared/links';
import { fetchPreview, placeFromUrl, positionFromUrl } from './preview';

/** A place's page as Google serves it, with the tags link previews read */
const placePage = `<html><head>
<meta content="A Place Where - APW · 29, Jalan Riong, Bangsar, 59100 Kuala Lumpur" property="og:title">
<meta content="★★★★☆ · Cafe" property="og:description">
<meta content="https://lh5.googleusercontent.com/p/abc=w900-h900" property="og:image">
</head></html>`;

const genericPage = `<meta content="Google Maps" property="og:title">
<meta content="https://maps.google.com/maps/api/staticmap?center=37.0625%2C-95.677068&amp;zoom=4" property="og:image">
<meta content="Find local businesses, view maps and get driving directions in Google Maps." property="og:description">`;

const redirect = (to: string) => new Response(null, { status: 302, headers: { Location: to } });

/** Stands in for the web: each address answers as `pages` says, and is noted */
function stubWeb(pages: Record<string, () => Response>) {
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: URL | string) => {
      const url = String(input);
      asked.push(url);
      const page = pages[url];
      return page == null
        ? Promise.reject(new Error(`not reachable: ${url}`))
        : Promise.resolve(page());
    }),
  );
  return asked;
}

afterEach(() => vi.unstubAllGlobals());

const PLACE =
  'https://www.google.com/maps/place/A+Place+Where+-+APW/@3.1297,101.6744,17z/data=!4m6';

describe('which links get a card', () => {
  it('takes Google Maps links, and nothing else', () => {
    for (const yes of [
      'https://maps.app.goo.gl/abc123',
      'https://share.google/P2KCOX2QH6QhNjrIb',
      'https://goo.gl/maps/xyz',
      'https://maps.google.com/?q=APW',
      'https://www.google.com/maps/place/APW',
      'https://www.google.com.my/maps/@3.1,101.6,15z',
    ]) {
      expect(isMapsLink(yes), yes).toBe(true);
    }
    for (const no of [
      'https://www.google.com/search?q=maps',
      'https://goo.gl/abc',
      'https://maps.app.goo.gl.evil.com/x',
      'https://maps.app.goo.gl@evil.com/x',
      'ftp://maps.google.com/',
      'https://example.com/maps/place/x',
    ]) {
      expect(isMapsLink(no), no).toBe(false);
    }
  });
});

describe('where a link says it points', () => {
  it('reads a position from each way Google writes one, and nothing from a short link', () => {
    const at = { lat: 3.88705, lng: 100.80439 };
    for (const link of [
      'https://maps.google.com/?q=3.887047,100.804389&entry=gps',
      'https://www.google.com/maps/search/?api=1&query=3.887047%2C100.804389',
      'https://www.google.com/maps/search/3.887047,+100.804389?entry=tts',
      'https://www.google.com/maps/place/3.887047,100.804389',
      'https://www.google.com/maps/place/X/data=!3d3.887047!4d100.804389',
      'https://www.google.com/maps/@3.887047,100.804389,17z',
    ]) {
      expect(positionInLink(link), link).toEqual(at);
    }
    // A place's link says where it is too, but it's the place it names
    expect(
      positionInLink('https://www.google.com/maps/place/APW/@3.1297,101.6744,17z', {
        pinOnly: true,
      }),
    ).toBeNull();
    expect(
      positionInLink('https://maps.google.com/?q=3.887047,100.804389', { pinOnly: true }),
    ).toEqual(at);
    for (const link of [
      'https://maps.app.goo.gl/y8F94Y1RPVDjz7ci8',
      'https://maps.google.com/?q=Truz+Tackles',
      'https://maps.google.com/?q=95.1,100.8',
    ]) {
      expect(positionInLink(link), link).toBeNull();
    }
  });
});

describe('a Maps link card', () => {
  it("follows a shared link to its place and reads the place's name, address and picture", async () => {
    stubWeb({
      'https://maps.app.goo.gl/abc123': () => redirect(PLACE),
      [PLACE]: () => new Response(placePage),
    });
    expect(await fetchPreview('https://maps.app.goo.gl/abc123')).toEqual({
      url: 'https://maps.app.goo.gl/abc123',
      title: 'A Place Where - APW',
      address: '29, Jalan Riong, Bangsar, 59100 Kuala Lumpur',
      detail: '★★★★☆ · Cafe',
      image: 'https://lh5.googleusercontent.com/p/abc=w900-h900',
      site: 'maps.app.goo.gl',
      // From the address it came to: the map's centre on the place
      position: { lat: 3.1297, lng: 101.6744 },
    });
  });

  it('never follows a redirect away from Google Maps, and names the place from the address', async () => {
    const asked = stubWeb({
      'https://maps.app.goo.gl/abc123': () => redirect(PLACE),
      [PLACE]: () => redirect('https://consent.google.com/ml?continue=x'),
    });
    const preview = await fetchPreview('https://maps.app.goo.gl/abc123');
    expect(asked).not.toContain('https://consent.google.com/ml?continue=x');
    expect(preview).toMatchObject({ title: 'A Place Where - APW', address: null, image: null });
  });

  it('falls back on the address when the page says nothing about the place', async () => {
    const shared = 'https://maps.google.com/?q=A+Place+Where,+29+Jalan+Riong,+Bangsar&ftid=0x1';
    stubWeb({ [shared]: () => new Response(genericPage) });
    expect(await fetchPreview(shared)).toMatchObject({
      title: 'A Place Where',
      address: '29 Jalan Riong, Bangsar',
      detail: null,
      image: null,
    });
  });

  it('names a dropped pin by its plus code in its town, as Google Maps does, with its position for a small map', async () => {
    // As a phone shares a dropped pin: a short link, then a position, then Google's page,
    // which names nothing and offers a map of the USA
    const pin = 'https://maps.google.com/?q=3.881664,100.803786&entry=gps&g_ep=abc';
    stubWeb({
      'https://goo.gl/maps/5AsHsHdzQVM3KtAY9?g_st=ac': () => redirect(pin),
      [pin]: () => new Response(genericPage),
    });
    const asked: number[][] = [];
    const named = await fetchPreview(
      'https://goo.gl/maps/5AsHsHdzQVM3KtAY9?g_st=ac',
      (lat, lng) => {
        asked.push([lat, lng]);
        return Promise.resolve('Bagan Datuk, Perak');
      },
    );
    expect(asked).toEqual([[3.88166, 100.80379]]);
    expect(named).toMatchObject({
      title: 'VRJ3+MG Bagan Datuk, Perak',
      address: null,
      image: null,
      position: { lat: 3.88166, lng: 100.80379 },
      site: 'goo.gl',
    });
    // Nowhere OpenStreetMap knows: its plus code in full
    expect(await fetchPreview('https://goo.gl/maps/5AsHsHdzQVM3KtAY9?g_st=ac')).toMatchObject({
      title: '6PM2VRJ3+MG',
      address: null,
    });

    // Shared from the app as a search for a position
    const search =
      'https://www.google.com/maps/search/3.887047,+100.804389?entry=tts&g_ep=abc&skid=x';
    stubWeb({
      'https://maps.app.goo.gl/y8F94Y1RPVDjz7ci8': () => redirect(search),
      [search]: () => new Response(genericPage),
    });
    expect(await fetchPreview('https://maps.app.goo.gl/y8F94Y1RPVDjz7ci8')).toMatchObject({
      title: '6PM2VRP3+RQ',
      position: { lat: 3.88705, lng: 100.80439 },
    });
    expect(positionFromUrl(new URL(PLACE.replace('/@', '/data=!3d3.2!4d101.7/@')))).toEqual({
      lat: 3.2,
      lng: 101.7,
    });
    expect(
      positionFromUrl(new URL('https://www.google.com/maps/search/?api=1&query=3.1,101.6')),
    ).toEqual({ lat: 3.1, lng: 101.6 });
  });

  it('names a place shared from Google (share.google) from where it leads, never reading Google Search', async () => {
    const SHARED = 'https://share.google/P2KCOX2QH6QhNjrIb';
    const HOP = 'https://www.google.com/share.google?q=P2KCOX2QH6QhNjrIb';
    const search = (source: string) =>
      `https://www.google.com/search?kgmid=/g/11cn8sfb8r&q=Kedai+Kopi+168&source=${source}`;
    const asked = stubWeb({
      [SHARED]: () => redirect(HOP),
      [HOP]: () => redirect(search('sh/x/loc/uni/m1/1')),
    });
    expect(await fetchPreview(SHARED)).toEqual({
      url: SHARED,
      title: 'Kedai Kopi 168',
      address: null,
      detail: null,
      image: null,
      site: 'share.google',
      // Google says where only on pages this doesn't read
      position: null,
    });
    expect(asked).toEqual([SHARED, HOP]);

    // Something else shared (a search, an article) names no place
    const other = stubWeb({
      [SHARED]: () => redirect(HOP),
      [HOP]: () => redirect(search('sh/x/srp/m1/1')),
    });
    expect(await fetchPreview(SHARED)).toMatchObject({ title: null, position: null });
    expect(other).toEqual([SHARED, HOP]);
  });

  it("takes a place's position from the map Google draws of it, not its map of nowhere", async () => {
    const page = (
      center: string,
    ) => `<meta content="Kedai Kopi 168 · Jalan SS 2/24, Petaling Jaya" property="og:title">
<meta content="https://maps.google.com/maps/api/staticmap?center=${center}&amp;zoom=15&amp;markers=x" property="og:image">`;
    const shared = 'https://maps.google.com/?q=Kedai+Kopi+168&ftid=0x1';
    stubWeb({ [shared]: () => new Response(page('3.1187%2C101.6205')) });
    expect(await fetchPreview(shared)).toMatchObject({
      title: 'Kedai Kopi 168',
      image: null,
      position: { lat: 3.1187, lng: 101.6205 },
    });
    stubWeb({ [shared]: () => new Response(page('37.0625%2C-95.677068')) });
    expect((await fetchPreview(shared)).position).toBeNull();
  });

  it('has nothing to show for a link that names no place and cannot be read', async () => {
    stubWeb({});
    expect(await fetchPreview('https://maps.app.goo.gl/gone')).toMatchObject({
      title: null,
      address: null,
      site: 'maps.app.goo.gl',
    });
    expect(placeFromUrl(new URL('https://maps.google.com/?q=3.1297,101.6744'))).toEqual({
      title: null,
      address: null,
    });
  });
});
