import { capMerchantPinsToNearest, MAX_MAP_MERCHANT_PINS } from './mapPins';
import type { BtcMapPlace } from '../services/btcMapService';

// Minimal but fully-valid BtcMapPlace — the compiler enforces the
// contract, so an interface change breaks these tests loudly.
const place = (id: number, lat: number, lon: number): BtcMapPlace => ({
  id,
  lat,
  lon,
  tags: { name: `p${id}` },
});

describe('capMerchantPinsToNearest', () => {
  it('returns the same array identity when under the cap', () => {
    const list = [place(1, 50, 0), place(2, 51, 1)];
    expect(capMerchantPinsToNearest(list, { lat: 50, lon: 0 }, 5)).toBe(list);
  });

  it('keeps the pins nearest the centre when over the cap', () => {
    const centre = { lat: 52.0, lon: 0.0 };
    const near = place(1, 52.01, 0.01);
    const mid = place(2, 52.5, 0.5);
    const far = place(3, 55.0, 5.0);
    const result = capMerchantPinsToNearest([far, near, mid], centre, 2);
    expect(result.map((p) => p.id)).toEqual([1, 2]);
  });

  it('truncates without a centre (no viewport settled yet)', () => {
    const list = [place(1, 50, 0), place(2, 51, 1), place(3, 52, 2)];
    const result = capMerchantPinsToNearest(list, null, 2);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.id)).toEqual([1, 2]);
  });

  it('defaults the cap to MAX_MAP_MERCHANT_PINS', () => {
    const list = Array.from({ length: MAX_MAP_MERCHANT_PINS + 50 }, (_, i) =>
      place(i, 50 + i * 0.001, 0),
    );
    expect(capMerchantPinsToNearest(list, { lat: 50, lon: 0 })).toHaveLength(MAX_MAP_MERCHANT_PINS);
  });
});

describe('bboxCentre', () => {
  const { bboxCentre } = jest.requireActual('./mapPins');

  it('returns the plain midpoint for a normal bbox', () => {
    expect(bboxCentre({ minLat: 50, maxLat: 54, minLon: -2, maxLon: 2 })).toEqual({
      lat: 52,
      lon: 0,
    });
  });

  it('wraps the longitude midpoint for an antimeridian-crossing bbox', () => {
    // 170..-170 crosses the dateline; naive averaging gives 0, the
    // correct wrapped midpoint is ±180.
    const c = bboxCentre({ minLat: -10, maxLat: 10, minLon: 170, maxLon: -170 });
    expect(c.lat).toBe(0);
    expect(Math.abs(c.lon)).toBe(180);
  });
});
