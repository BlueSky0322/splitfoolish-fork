import { describe, expect, it } from 'vitest';
import { placeLabel, plusCode, plusCodeLabel } from './places';

describe('where a place is, without a name', () => {
  it("is its plus code, as Open Location Code's own test data gives them", () => {
    for (const [lat, lng, code] of [
      [20.3700625, 2.7821875, '7FG49QCJ+2V'],
      [47.0000625, 8.0000625, '8FVC2222+22'],
      [-44.545247, -40.700335, '487XF73X+WV'],
      [-41.2730625, 174.7859375, '4VCPPQGP+Q9'],
      [-37.014, -159.936, '43J2X3P7+CJ'],
      // The edges of the map
      [90, 1, 'CFX3X2X2+X2'],
      [-89.9999375, -179.9999375, '22222222+22'],
    ] as const) {
      expect(plusCode(lat, lng), `${lat},${lng}`).toBe(code);
    }
    // Round the world past 180
    expect(plusCode(1, 181)).toBe(plusCode(1, -179));
  });

  it('is short with its town, else in full', () => {
    expect(plusCodeLabel(47.0000625, 8.0000625, 'Zug, Switzerland')).toBe(
      '2222+22 Zug, Switzerland',
    );
    expect(plusCodeLabel(47.0000625, 8.0000625)).toBe('8FVC2222+22');
  });

  it('is the name when there is one', () => {
    expect(placeLabel({ lat: 3.1, lng: 101.6, name: 'APW' })).toBe('APW');
    expect(placeLabel({ lat: 3.1, lng: 101.6, name: null })).toBe(plusCode(3.1, 101.6));
  });
});
