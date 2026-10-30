import { describe, expect, it } from 'vitest';
import { placeLabel, plusCode, plusCodeLabel, plusCodePosition, readPlusCode } from './places';

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

  it("finds where a typed plus code is, a short one near what it's given, as the standard's test data does", () => {
    expect(readPlusCode('vrj3+mg Bagan Datuk, Perak')).toEqual({
      code: 'VRJ3+MG',
      full: false,
      town: 'Bagan Datuk, Perak',
    });
    expect(readPlusCode('6PM2VRJ3+MG')).toEqual({ code: '6PM2VRJ3+MG', full: true, town: null });
    expect(readPlusCode('Kedai Kopi 168')).toBeNull();
    // A full code is its box's middle
    expect(plusCodePosition('6PM2VRJ3+MG', null)).toEqual({ lat: 3.88169, lng: 100.80381 });
    // A short one is the nearest such box: across a line when that's closer
    for (const [full, lat, lng, short] of [
      ['8FVC2GGG+GG', 46.976, 8.526, '2GGG+GG'],
      ['8FRCXGGG+GG', 47.026, 8.526, 'XGGG+GG'],
      ['8FR9GXGG+GG', 46.526, 8.026, 'GXGG+GG'],
      ['8FRCG2GG+GG', 46.526, 7.976, 'G2GG+GG'],
      ['CFX22222+22', 89.6, 0.0, '2222+22'],
    ] as const) {
      const at = plusCodePosition(short, { lat, lng })!;
      expect(plusCode(at.lat, at.lng), short).toBe(full);
    }
    expect(plusCodePosition('VRJ3+MG', null)).toBeNull();
  });
});
