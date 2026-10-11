import {
  LIVE_LOCATION_TAG,
  MARMOT_LIVE_UPDATE_KIND,
  formatShareDuration,
  liveMarkerContent,
  liveMarkerDraft,
  liveMarkerInternalText,
  liveMarkerTags,
  liveMarkerTextForRumor,
  mapsLink,
  marmotLiveUpdateDraft,
  parseLiveMarkerTags,
  parseMarmotLiveUpdate,
  type LiveMarkerWire,
} from './liveLocationWire';
import { parseLiveLocationMarker, LIVE_LOCATION_PING_KIND } from './liveLocationService';
import { textForRumor } from '../utils/nip17Unwrap';
import { dmRowPreview } from '../utils/dmRowPreview';
import { rowsToInboxEntries } from './dmInbox';
import type { DmMessageRow } from './dmDb';

const HEX = (c: string) => c.repeat(64);
const london = { lat: 51.5074, lon: -0.1278, accuracyMeters: 12 };
const start: LiveMarkerWire = {
  phase: 'start',
  sessionId: '0123456789abcdef',
  startedAt: 1_760_000_000_000,
  durationMs: 60 * 60 * 1000,
  location: london,
  updateKey: { pubkey: HEX('a'), secret: HEX('b') },
};
const end: LiveMarkerWire = {
  phase: 'end',
  sessionId: start.sessionId,
  startedAt: start.startedAt,
  durationMs: start.durationMs,
  location: null,
};

// White Noise's own matcher (LocationShare.kt MAPS_QUERY_COORDINATE_PATTERN):
// a kind-9 body containing this link renders WN's native map card.
const WN_MAPS_RE =
  /https:\/\/maps\.google\.com\/(?:maps)?\?q=(-?\d+(?:\.\d+)?)(?:,|%2C)(-?\d+(?:\.\d+)?)/i;

describe('marker content other clients display', () => {
  it('is readable text plus a maps link White Noise turns into a map card', () => {
    const text = liveMarkerContent(start);
    expect(text).toBe(
      '📍 Sharing my live location for 1 h\nhttps://maps.google.com/maps?q=51.507400,-0.127800',
    );
    const m = WN_MAPS_RE.exec(text)!;
    expect([Number(m[1]), Number(m[2])]).toEqual([51.5074, -0.1278]);
    // No sentinel, JSON or secrets in what other clients show.
    expect(text).not.toMatch(/live-location:|\{|b{64}/);
  });

  it('end marker without a fix is just the label', () => {
    expect(liveMarkerContent(end)).toBe('📍 Live location ended');
  });

  it('formats durations compactly', () => {
    expect(formatShareDuration(15 * 60_000)).toBe('15 min');
    expect(formatShareDuration(8 * 3_600_000)).toBe('8 h');
    expect(formatShareDuration(90 * 60_000)).toBe('1 h 30 min');
  });

  it('mapsLink uses dot decimals at 6 places', () => {
    expect(mapsLink({ lat: -33.9, lon: 151.2, accuracyMeters: null })).toBe(
      'https://maps.google.com/maps?q=-33.900000,151.200000',
    );
  });
});

describe('marker tags', () => {
  it('round-trip start (with the NIP-17 update key) and end', () => {
    expect(parseLiveMarkerTags(liveMarkerTags(start))).toEqual({
      ...start,
      location: { lat: 51.5074, lon: -0.1278, accuracyMeters: 12 },
    });
    expect(parseLiveMarkerTags(liveMarkerTags(end))).toEqual(end);
  });

  it('carry a NIP-31 alt tag and only put the key on a start', () => {
    const tags = liveMarkerTags(start);
    expect(tags.find((t) => t[0] === 'alt')?.[1]).toBe('📍 Sharing my live location for 1 h');
    expect(
      liveMarkerTags({ ...end, updateKey: start.updateKey }).some(
        (t) => t[0] === 'live-location-key',
      ),
    ).toBe(false);
  });

  it('reject malformed tags', () => {
    const base = liveMarkerTags(start)[0];
    const variants: string[][] = [
      [LIVE_LOCATION_TAG, 'middle', ...base.slice(2)],
      [LIVE_LOCATION_TAG, 'start', 'not hex!', ...base.slice(3)],
      [LIVE_LOCATION_TAG, 'start', base[2], 'NaN', base[4], base[5]],
      // A start must carry its first fix.
      [LIVE_LOCATION_TAG, 'start', base[2], base[3], base[4], ''],
      [LIVE_LOCATION_TAG, 'start', base[2], base[3], base[4], 'geo:91,0'],
    ];
    for (const v of variants) expect(parseLiveMarkerTags([v])).toBeNull();
    expect(parseLiveMarkerTags([['p', HEX('c')]])).toBeNull();
  });

  it('drop a malformed update key rather than the marker', () => {
    const tags = [liveMarkerTags(start)[0], ['live-location-key', 'nope', HEX('b')]];
    const parsed = parseLiveMarkerTags(tags)!;
    expect(parsed.phase).toBe('start');
    expect(parsed.updateKey).toBeUndefined();
  });

  it('cap the duration at 8 h', () => {
    const tag = liveMarkerTags(start)[0].slice();
    tag[4] = String(48 * 3_600_000);
    expect(parseLiveMarkerTags([tag])!.durationMs).toBe(8 * 3_600_000);
  });
});

describe('stored (internal) form', () => {
  it('parses back to the same marker, flagged v2, key included', () => {
    const marker = parseLiveLocationMarker(liveMarkerInternalText(start))!;
    expect(marker).toMatchObject({
      phase: 'start',
      sessionId: start.sessionId,
      startedAt: start.startedAt,
      durationMs: start.durationMs,
      updateKey: start.updateKey,
      v2: true,
    });
    expect(marker.location).toMatchObject({ lat: 51.5074, lon: -0.1278 });
    const ended = parseLiveLocationMarker(liveMarkerInternalText(end))!;
    expect(ended).toMatchObject({ phase: 'end', location: null, v2: true });
  });

  it('textForRumor stores tagged NIP-17 and Marmot markers in the internal form', () => {
    const draft = liveMarkerDraft(start);
    const internal = liveMarkerInternalText(start);
    for (const kind of [14, 9]) {
      expect(
        textForRumor({
          pubkey: HEX('d'),
          created_at: 1,
          kind,
          tags: draft.tags,
          content: draft.content,
        }),
      ).toBe(internal);
    }
    // Same tags on another kind are left alone.
    expect(liveMarkerTextForRumor({ kind: 1, tags: draft.tags })).toBeNull();
    // A plain chat message is untouched.
    expect(
      textForRumor({ pubkey: HEX('d'), created_at: 1, kind: 14, tags: [], content: 'hi' }),
    ).toBe('hi');
  });

  it('chat-list previews show a label, never the stored marker (it holds the update secret)', () => {
    expect(dmRowPreview(liveMarkerInternalText(start), 14)).toBe('📍 Live location');
    expect(dmRowPreview(liveMarkerInternalText(end), 14)).toBe('📍 Live location ended');
  });

  it('inbox entries keep the marker in renderText for the thread and the Full Map', () => {
    const content = liveMarkerInternalText(start);
    const row = {
      owner: HEX('d'),
      eventId: 'e1',
      conversation: HEX('c'),
      createdAt: 1,
      sender: HEX('c'),
      content,
      fromMe: false,
      wireKind: 14,
    } as DmMessageRow;
    const [entry] = rowsToInboxEntries([row, { ...row, eventId: 'e2', content: 'hello' }]);
    expect(entry).toMatchObject({ text: '📍 Live location', renderText: content });
    expect(rowsToInboxEntries([{ ...row, content: 'hello' }])[0].renderText).toBeUndefined();
  });
});

describe('Marmot coordinate update', () => {
  const payload = {
    lat: 1.5,
    lon: 2.5,
    accuracy: 8,
    heading: 90,
    ts: 1_760_000_123_000,
    sessionId: 'ab12',
  };

  it('is an ephemeral-range inner kind with the JSON payload and no tags', () => {
    const draft = marmotLiveUpdateDraft(payload);
    expect(draft.kind).toBe(MARMOT_LIVE_UPDATE_KIND);
    expect(MARMOT_LIVE_UPDATE_KIND).toBe(LIVE_LOCATION_PING_KIND);
    expect(MARMOT_LIVE_UPDATE_KIND >= 20000 && MARMOT_LIVE_UPDATE_KIND < 30000).toBe(true);
    expect(draft.tags).toEqual([]);
    expect(parseMarmotLiveUpdate(draft)).toEqual(payload);
  });

  it('rejects other kinds and bad payloads', () => {
    expect(parseMarmotLiveUpdate({ kind: 9, content: JSON.stringify(payload) })).toBeNull();
    expect(
      parseMarmotLiveUpdate({ kind: MARMOT_LIVE_UPDATE_KIND, content: '{"lat":200}' }),
    ).toBeNull();
    expect(
      parseMarmotLiveUpdate({ kind: MARMOT_LIVE_UPDATE_KIND, content: 'not json' }),
    ).toBeNull();
  });
});
