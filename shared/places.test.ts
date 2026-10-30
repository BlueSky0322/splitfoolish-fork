import { describe, expect, it } from 'vitest';
import { coordsLabel, placeLabel } from './places';

describe('where a place is, without a name', () => {
  it('reads as Google Maps writes a dropped pin', () => {
    expect(coordsLabel(3.88166, 100.80379)).toBe(`3°52'54.0"N 100°48'13.6"E`);
    expect(coordsLabel(-33.86785, 151.20732)).toBe(`33°52'04.3"S 151°12'26.4"E`);
    expect(coordsLabel(40.7484, -73.98567)).toBe(`40°44'54.2"N 73°59'08.4"W`);
    // 59.99" carries into the next minute
    expect(coordsLabel(1.0333311, 0)).toBe(`1°02'00.0"N 0°00'00.0"E`);
  });

  it('is the name when there is one', () => {
    expect(placeLabel({ lat: 3.1, lng: 101.6, name: 'APW' })).toBe('APW');
    expect(placeLabel({ lat: 3.1, lng: 101.6, name: null })).toBe(`3°06'00.0"N 101°36'00.0"E`);
  });
});
