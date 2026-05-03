/**
 * Coverage for the pure (non-permission) helpers in locationService:
 * geo: URI formatter + parser, OSM URL builder, slippy-map URL builder,
 * coords formatter. The permission-gated `getCurrentLocation` flow is
 * out of scope here — it depends on Expo's Location runtime and would
 * require mocking expo-location wholesale.
 */

import {
  buildOsmViewUrl,
  buildStaticMapUrl,
  formatCoordsForDisplay,
  formatGeoMessage,
  parseGeoMessage,
  USER_AGENT,
} from './locationService';

describe('formatGeoMessage', () => {
  it('emits the geo: URI + OSM link with 5 decimal places', () => {
    const out = formatGeoMessage({ lat: 51.50735, lon: -0.12776, accuracyMeters: 12 });
    expect(out).toContain('geo:51.50735,-0.12776;u=12');
    expect(out).toContain('https://www.openstreetmap.org/?mlat=51.50735&mlon=-0.12776');
    // The leading 📍 emoji is part of the contract — clients without a
    // geo-URI parser still see something meaningful.
    expect(out).toContain('📍');
  });

  it('omits the ;u= suffix when no accuracy is known', () => {
    const out = formatGeoMessage({ lat: 0, lon: 0, accuracyMeters: null });
    expect(out).toContain('geo:0.00000,0.00000\n');
    expect(out).not.toContain(';u=');
  });
});

describe('parseGeoMessage', () => {
  it('returns null for empty / non-matching input', () => {
    expect(parseGeoMessage('')).toBeNull();
    expect(parseGeoMessage('hello')).toBeNull();
  });

  it('round-trips a formatted message', () => {
    const original = { lat: 12.34567, lon: -76.54321, accuracyMeters: 9 };
    const out = parseGeoMessage(formatGeoMessage(original));
    expect(out).toEqual(original);
  });

  it('parses a bare geo: URI without any surrounding text', () => {
    expect(parseGeoMessage('geo:1.0,2.0')).toEqual({
      lat: 1.0,
      lon: 2.0,
      accuracyMeters: null,
    });
  });

  it('rejects out-of-range coordinates', () => {
    expect(parseGeoMessage('geo:91,0')).toBeNull();
    expect(parseGeoMessage('geo:0,181')).toBeNull();
    expect(parseGeoMessage('geo:-91,0')).toBeNull();
  });

  it('rejects nonsense accuracy values but still returns the coordinates', () => {
    // Accuracy past the 40_000_000 m ceiling is dropped to null,
    // not allowed to bubble up as an absurd radius.
    expect(parseGeoMessage('geo:0,0;u=99999999999')).toEqual({
      lat: 0,
      lon: 0,
      accuracyMeters: null,
    });
  });
});

describe('buildOsmViewUrl', () => {
  it('includes mlat/mlon and the configured zoom', () => {
    const out = buildOsmViewUrl({ lat: 1.234567, lon: 2.345678, accuracyMeters: null });
    expect(out).toContain('mlat=1.23457');
    expect(out).toContain('mlon=2.34568');
    expect(out).toContain('#map=16/');
  });

  it('respects a custom zoom', () => {
    const out = buildOsmViewUrl({ lat: 0, lon: 0, accuracyMeters: null }, 11);
    expect(out).toContain('#map=11/');
  });
});

describe('buildStaticMapUrl', () => {
  it('returns a tile.openstreetmap.org URL with z/x/y in path', () => {
    const out = buildStaticMapUrl({ lat: 0, lon: 0, accuracyMeters: null });
    expect(out).toMatch(/^https:\/\/tile\.openstreetmap\.org\/15\/\d+\/\d+\.png$/);
  });

  it('respects a custom zoom level', () => {
    const out = buildStaticMapUrl({ lat: 0, lon: 0, accuracyMeters: null }, { zoom: 4 });
    expect(out).toMatch(/^https:\/\/tile\.openstreetmap\.org\/4\/\d+\/\d+\.png$/);
  });
});

describe('formatCoordsForDisplay', () => {
  it('renders a positive lat/lon with N/E', () => {
    expect(formatCoordsForDisplay({ lat: 1.23456, lon: 2.34567, accuracyMeters: null })).toBe(
      '1.2346° N, 2.3457° E',
    );
  });

  it('renders a negative lat/lon with S/W', () => {
    expect(formatCoordsForDisplay({ lat: -1.23456, lon: -2.34567, accuracyMeters: null })).toBe(
      '1.2346° S, 2.3457° W',
    );
  });
});

describe('USER_AGENT', () => {
  it('includes the LightningPiggyMobile app identifier', () => {
    expect(USER_AGENT).toContain('LightningPiggyMobile/');
    expect(USER_AGENT).toContain('lightningpiggy.com');
  });
});
