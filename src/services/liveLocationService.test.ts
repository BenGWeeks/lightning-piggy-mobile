/**
 * Wire-format tests for the live-location share helpers.
 *
 *   - `formatLiveStartMessage` / `parseLiveLocationMarker` round-trip.
 *   - `encodeLivePingPayload` / `decodeLivePingPayload` round-trip.
 *   - `LIVE_LOCATION_PING_KIND` lives in the NIP-01 ephemeral range
 *      so relays don't accidentally persist coordinate pings.
 *   - `parseLiveLocationMarker` rejects malformed coordinates rather
 *      than crashing the bubble.
 */

import {
  LIVE_LOCATION_PING_KIND,
  LIVE_START_HEADER,
  LIVE_END_HEADER,
  MAX_DURATION_MS,
  decodeLivePingPayload,
  encodeLivePingPayload,
  expiryFor,
  formatLiveEndMessage,
  formatLiveStartMessage,
  parseLiveLocationMarker,
} from './liveLocationService';

describe('LIVE_LOCATION_PING_KIND', () => {
  it('lives inside the NIP-01 ephemeral range (20000-29999)', () => {
    // Relays in this range MUST NOT persist events — the contract
    // we're relying on for high-frequency coordinate pings.
    expect(LIVE_LOCATION_PING_KIND).toBeGreaterThanOrEqual(20000);
    expect(LIVE_LOCATION_PING_KIND).toBeLessThanOrEqual(29999);
  });
});

describe('formatLiveStartMessage / parseLiveLocationMarker', () => {
  const baseInput = {
    sessionId: 'abc123def4567890',
    durationMs: 15 * 60 * 1000,
    startedAt: 1_700_000_000_000,
    location: { lat: 51.5072, lon: -0.1276, accuracyMeters: 12 },
  };

  it('round-trips a start marker including session metadata', () => {
    const text = formatLiveStartMessage(baseInput);
    expect(text.startsWith(LIVE_START_HEADER)).toBe(true);
    const parsed = parseLiveLocationMarker(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.phase).toBe('start');
    expect(parsed?.sessionId).toBe(baseInput.sessionId);
    expect(parsed?.durationMs).toBe(baseInput.durationMs);
    expect(parsed?.startedAt).toBe(baseInput.startedAt);
    expect(parsed?.location.lat).toBeCloseTo(baseInput.location.lat, 4);
    expect(parsed?.location.lon).toBeCloseTo(baseInput.location.lon, 4);
    expect(parsed?.location.accuracyMeters).toBe(12);
  });

  it('round-trips an end marker', () => {
    const text = formatLiveEndMessage(baseInput);
    expect(text.startsWith(LIVE_END_HEADER)).toBe(true);
    const parsed = parseLiveLocationMarker(text);
    expect(parsed?.phase).toBe('end');
  });

  it('caps an oversized durationMs to MAX_DURATION_MS during parse', () => {
    const text = formatLiveStartMessage({
      ...baseInput,
      durationMs: 24 * 60 * 60 * 1000,
    });
    const parsed = parseLiveLocationMarker(text);
    expect(parsed?.durationMs).toBe(MAX_DURATION_MS);
  });

  it('returns null for plain DM bodies (no live header)', () => {
    expect(parseLiveLocationMarker('hello')).toBeNull();
    // Snapshot-only message — has a geo URI but no live header. Must
    // fall through so the existing snapshot bubble path keeps working.
    expect(
      parseLiveLocationMarker('📍 Shared location\ngeo:51.5,-0.1\nhttps://osm.example/'),
    ).toBeNull();
  });

  it('rejects coordinates outside earth bounds', () => {
    const text = `${LIVE_START_HEADER}\n{}\ngeo:200,0`;
    expect(parseLiveLocationMarker(text)).toBeNull();
  });

  it('salvages coordinates when the JSON metadata block is missing', () => {
    // A re-encoding pipeline could drop the metadata line. The bubble
    // should still render — sessionId / durationMs default to "no
    // ongoing share" so the receiver doesn't subscribe to a non-existent
    // session.
    const text = `${LIVE_START_HEADER}\ngeo:51.5,0`;
    const parsed = parseLiveLocationMarker(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.sessionId).toBe('');
    expect(parsed?.durationMs).toBe(0);
  });
});

describe('encodeLivePingPayload / decodeLivePingPayload', () => {
  it('round-trips a complete payload', () => {
    const payload = {
      lat: 51.5072,
      lon: -0.1276,
      accuracy: 8,
      heading: 90,
      ts: 1_700_000_010_000,
      sessionId: 'abc123',
    };
    const json = encodeLivePingPayload(payload);
    const decoded = decodeLivePingPayload(json);
    expect(decoded).toEqual(payload);
  });

  it('rejects payloads missing a sessionId — those would clog the receiver filter', () => {
    expect(decodeLivePingPayload('{"lat":1,"lon":2,"ts":3}')).toBeNull();
  });

  it('rejects out-of-range coordinates', () => {
    expect(
      decodeLivePingPayload(JSON.stringify({ lat: 200, lon: 0, ts: 1, sessionId: 'x' })),
    ).toBeNull();
  });

  it('returns null for non-JSON garbage', () => {
    expect(decodeLivePingPayload('not json')).toBeNull();
  });

  it('defaults nullable fields when the sender omits them', () => {
    const json = JSON.stringify({ lat: 1, lon: 2, sessionId: 'x' });
    const decoded = decodeLivePingPayload(json);
    expect(decoded?.accuracy).toBeNull();
    expect(decoded?.heading).toBeNull();
    expect(decoded?.ts).toEqual(expect.any(Number));
  });
});

describe('expiryFor', () => {
  it('caps to MAX_DURATION_MS', () => {
    expect(expiryFor(0, 10 * 60 * 60 * 1000)).toBe(MAX_DURATION_MS);
  });

  it('clamps negative durations to 0', () => {
    expect(expiryFor(1000, -500)).toBe(1000);
  });

  it('passes a within-range duration through', () => {
    expect(expiryFor(1000, 60_000)).toBe(61_000);
  });
});
