/**
 * Live-location wire format v2 (#1300) — what goes on the wire, for both
 * transports, as opposed to the internal sentinel text the app stores and
 * renders (`liveLocationService.ts`).
 *
 * Start / end markers are ordinary chat messages (NIP-17 kind 14, Marmot
 * kind 9) whose `content` is human-readable — "📍 Sharing my live location
 * for 1 h" plus a `maps.google.com/maps?q=lat,lon` link — so White Noise
 * (which draws its native map card for that link), Amethyst and every other
 * client show a sensible location message, never a sentinel + JSON blob. The
 * machine-readable part rides in a tag:
 *
 *   ["live-location", phase, sessionId, startedAtMs, durationMs, geoUri]
 *   ["live-location-key", updatePubkey, updateSecret]   (NIP-17 start only)
 *   ["alt", <the human text's first line>]              (NIP-31)
 *
 * `textForRumor` (the one choke point NIP-17 unwrap and Marmot ingest share)
 * turns a tagged marker back into the internal sentinel text, so the
 * classifier, bubble, previews and Map scan keep working unchanged.
 *
 * Coordinate updates in a Marmot chat are inner app events of kind 20069 —
 * NIP-01's ephemeral range, i.e. "not expected to be stored" — carrying the
 * same JSON payload as the NIP-17 update. MLS supplies encryption and sender
 * authentication, so there is no NIP-04 and no p/d metadata.
 */

import { t } from '../i18n';
import type { SharedLocation } from './locationService';
import {
  LIVE_LOCATION_PING_KIND,
  MAX_DURATION_MS,
  decodeLivePingPayload,
  encodeLivePingPayload,
  formatLiveEndMessage,
  formatLiveStartMessage,
  parseLiveUpdateKey,
  type LiveLocationPhase,
  type LivePingPayload,
  type LiveUpdateKey,
} from './liveLocationService';

export const LIVE_LOCATION_TAG = 'live-location';
export const LIVE_LOCATION_KEY_TAG = 'live-location-key';

/** Inner kind of a Marmot coordinate update (same number as the NIP-17 update). */
export const MARMOT_LIVE_UPDATE_KIND = LIVE_LOCATION_PING_KIND;

/** Chat kinds a marker may ride in: NIP-17 kind 14, Marmot kind 9. */
const MARKER_KINDS: readonly number[] = [9, 14];

export interface LiveMarkerWire {
  phase: LiveLocationPhase;
  sessionId: string;
  startedAt: number;
  durationMs: number;
  location: SharedLocation | null;
  updateKey?: LiveUpdateKey;
}

/** The precise-point maps link White Noise parses into a map card. */
export function mapsLink(loc: SharedLocation): string {
  return `https://maps.google.com/maps?q=${loc.lat.toFixed(6)},${loc.lon.toFixed(6)}`;
}

/** "15 min" / "1 h" / "1 h 30 min" — the share length in the start text. */
export function formatShareDuration(durationMs: number): string {
  const totalMins = Math.max(1, Math.round(durationMs / 60_000));
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours === 0) return t('liveLocationWire.durationMins', { mins });
  if (mins === 0) return t('liveLocationWire.durationHours', { hours });
  return t('liveLocationWire.durationHoursMins', { hours, mins });
}

function geoUri(loc: SharedLocation): string {
  const acc = loc.accuracyMeters !== null ? `;u=${loc.accuracyMeters}` : '';
  return `geo:${loc.lat.toFixed(6)},${loc.lon.toFixed(6)}${acc}`;
}

const GEO_RE = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:;u=(\d+(?:\.\d+)?))?$/i;

function parseGeoUri(value: string | undefined): SharedLocation | null {
  const m = value ? GEO_RE.exec(value) : null;
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return null;
  }
  let accuracyMeters: number | null = null;
  if (m[3] !== undefined) {
    const n = Number(m[3]);
    if (isFinite(n) && n >= 0 && n < 40_000_000) accuracyMeters = Math.round(n);
  }
  return { lat, lon, accuracyMeters };
}

/** Human-readable marker body other clients display. */
export function liveMarkerContent(m: LiveMarkerWire): string {
  const first =
    m.phase === 'start'
      ? `\u{1F4CD} ${t('liveLocationWire.startText', { duration: formatShareDuration(m.durationMs) })}`
      : `\u{1F4CD} ${t('liveLocationWire.endText')}`;
  return m.location ? `${first}\n${mapsLink(m.location)}` : first;
}

/** The marker's machine-readable tags (see the module header). */
export function liveMarkerTags(m: LiveMarkerWire): string[][] {
  const tags: string[][] = [
    [
      LIVE_LOCATION_TAG,
      m.phase,
      m.sessionId,
      String(m.startedAt),
      String(m.durationMs),
      m.location ? geoUri(m.location) : '',
    ],
  ];
  if (m.phase === 'start' && m.updateKey) {
    tags.push([LIVE_LOCATION_KEY_TAG, m.updateKey.pubkey, m.updateKey.secret]);
  }
  tags.push(['alt', liveMarkerContent(m).split('\n')[0]]);
  return tags;
}

/** Parse a tagged marker back out of a rumor's tags, or null. */
export function parseLiveMarkerTags(tags: string[][]): LiveMarkerWire | null {
  const tag = tags.find((x) => x[0] === LIVE_LOCATION_TAG);
  if (!tag) return null;
  const [, phase, sessionId, startedAtRaw, durationRaw, geo] = tag;
  if (phase !== 'start' && phase !== 'end') return null;
  if (!sessionId || !/^[0-9a-f]{1,64}$/i.test(sessionId)) return null;
  const startedAt = Number(startedAtRaw);
  const durationMs = Number(durationRaw);
  if (!isFinite(startedAt) || startedAt <= 0 || !isFinite(durationMs) || durationMs < 0) {
    return null;
  }
  const location = parseGeoUri(geo);
  // A start always carries its first fix; an end may not (stopped with no fix).
  if (phase === 'start' && !location) return null;
  const keyTag = tags.find((x) => x[0] === LIVE_LOCATION_KEY_TAG);
  const updateKey = phase === 'start' ? parseLiveUpdateKey(keyTag?.[1], keyTag?.[2]) : undefined;
  return {
    phase,
    sessionId,
    startedAt: Math.round(startedAt),
    durationMs: Math.min(MAX_DURATION_MS, Math.round(durationMs)),
    location,
    ...(updateKey ? { updateKey } : {}),
  };
}

/** The internal sentinel text the app stores + renders for a wire marker. */
export function liveMarkerInternalText(m: LiveMarkerWire): string {
  return m.phase === 'start' && m.location
    ? formatLiveStartMessage({ ...m, location: m.location, v2: true })
    : formatLiveEndMessage({ ...m, v2: true });
}

/**
 * Stored text for a received (or our own echoed) chat rumor that is a
 * tagged live-location marker; null for anything else.
 */
export function liveMarkerTextForRumor(rumor: { kind: number; tags: string[][] }): string | null {
  if (!MARKER_KINDS.includes(rumor.kind)) return null;
  const marker = parseLiveMarkerTags(rumor.tags);
  return marker ? liveMarkerInternalText(marker) : null;
}

/** The chat draft for a marker (kind 14; Marmot maps it to 9 on send). */
export function liveMarkerDraft(m: LiveMarkerWire): {
  kind: 14;
  content: string;
  tags: string[][];
} {
  return { kind: 14, content: liveMarkerContent(m), tags: liveMarkerTags(m) };
}

/** A Marmot coordinate-update app event draft. */
export function marmotLiveUpdateDraft(payload: LivePingPayload): {
  kind: number;
  content: string;
  tags: string[][];
} {
  return { kind: MARMOT_LIVE_UPDATE_KIND, content: encodeLivePingPayload(payload), tags: [] };
}

/** Decode a Marmot coordinate update, or null if it isn't a valid one. */
export function parseMarmotLiveUpdate(rumor: {
  kind: number;
  content: string;
}): LivePingPayload | null {
  if (rumor.kind !== MARMOT_LIVE_UPDATE_KIND) return null;
  return decodeLivePingPayload(rumor.content);
}
