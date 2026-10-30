import { describe, expect, it } from 'vitest';
import { nameOf } from './names';

describe("a place's name", () => {
  it("is the spot's own name and its town", () => {
    expect(
      nameOf({
        name: 'Truz Tackles',
        address: { road: 'Jalan Kuala Selangor-Teluk Intan', city: 'Kuala Selangor' },
      }),
    ).toBe('Truz Tackles, Kuala Selangor');
  });

  it('is the road and town where the spot has no name', () => {
    expect(
      nameOf({
        name: '',
        address: {
          road: 'Jalan Kuala Selangor-Teluk Intan',
          suburb: 'Pasir Penambang',
          city: 'Kuala Selangor',
        },
      }),
    ).toBe('Jalan Kuala Selangor-Teluk Intan, Kuala Selangor');
  });

  it('takes a town or village when there is no city, and never says a name twice', () => {
    expect(nameOf({ name: 'Bukit Tinggi', address: { village: 'Bukit Tinggi' } })).toBe(
      'Bukit Tinggi',
    );
    expect(nameOf({ address: { road: 'Jalan Riong', town: 'Bangsar' } })).toBe(
      'Jalan Riong, Bangsar',
    );
    // Known only by its area (an unnamed road in the country): its plus code there, as
    // Google Maps writes it; the area alone where the position isn't given
    const area = {
      name: '',
      address: { district: 'Bagan Datuk', state: 'Perak', postcode: '36200' },
    };
    expect(nameOf(area, { lat: 3.88166, lng: 100.80379 })).toBe('VRJ3+MG Bagan Datuk, Perak');
    expect(nameOf(area)).toBe('Bagan Datuk, Perak');
    expect(nameOf({ address: { road: 'Jalan Sungai Nipah', state: 'Perak' } })).toBe(
      'Jalan Sungai Nipah, Perak',
    );
  });

  it('is nothing in the middle of nowhere, and never longer than a place name may be', () => {
    expect(nameOf({ address: {} })).toBeNull();
    const long = nameOf({ name: 'x'.repeat(200), address: { city: 'Ipoh' } })!;
    expect(long).toHaveLength(120);
    expect(long.endsWith('…')).toBe(true);
  });
});
