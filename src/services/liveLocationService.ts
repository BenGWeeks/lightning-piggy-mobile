/**
 * Live-location share — the user picks a duration (15 min / 1 h / 8 h),
 * we send a NIP-04 DM "Live location share started" with initial coords +
 * a sessionId + the chosen duration, then publish ephemeral kind-20069
 * pings every ~30 s with the latest coordinates while the watcher is
 * running. On stop / expiry / app shutdown we send a "Live location share
 * ended" DM with the last coords so the receiver has a persistent marker
 * pair in the thread.
 *
 * Wire format choices:
 *
 *   1. Start / end markers go through `sendDirectMessage` (NIP-04 kind-4
 *      to match the existing snapshot share). The body embeds a `geo:`
 *      URI so existing clients still render a location card, plus a
 *      sentinel header line ("[live-location:start]" or ":end") followed
 *      by a JSON metadata block with sessionId / duration / phase.
 *
 *   2. Intermediate pings are kind-20069 ephemeral events — NIP-01 says
 *      relays MUST drop the 20000-29999 range without persisting, which
 *      is exactly what we want for high-frequency coordinate updates.
 *      Content is NIP-04 encrypted JSON so the coordinates aren't visible
 *      to relay operators. Tags carry `['p', recipient]` for relay
 *      routing and `['d', sessionId]` so the receiver's filter only
 *      matches pings for the active session.
 *
 *   3. We picked 20069 because it doesn't conflict with any drafted NIP
 *      we could find. If a real spec (e.g. a future "NIP-LOC") standardises
 *      a kind in this range we can migrate.
 */

import type { SharedLocation } from './locationService';
import { buildOsmViewUrl, formatGeoMessage } from './locationService';

/**
 * Ephemeral kind for live-location coordinate pings. NIP-01 reserves
 * 20000-29999 for ephemeral events (relays don't persist, fan-out only).
 * App-specific allocation — no conflicting NIP at time of writing.
 */
export const LIVE_LOCATION_PING_KIND = 20069;

/** Default cadence between coordinate pings while moving (ms). */
export const DEFAULT_PING_INTERVAL_MS = 30_000;

/** Cap on a single live-share session. Prevents runaway shares if the
 *  app is left running unattended; the user can stop earlier at any
 *  time from the in-thread bubble. */
export const MAX_DURATION_MS = 60 * 60 * 1000;

/** Predefined duration options users can pick from in the chooser. */
export const DURATION_OPTIONS: ReadonlyArray<{
  /** Stable id used as a Maestro test selector. */
  id: '15m' | '1h';
  /** Human label for the picker row. */
  label: string;
  /** Duration in milliseconds. Always ≤ MAX_DURATION_MS. */
  ms: number;
}> = [
  { id: '15m', label: '15 minutes', ms: 15 * 60 * 1000 },
  { id: '1h', label: '1 hour', ms: 60 * 60 * 1000 },
];

/** Sentinel headers — the receiver matches these to classify a regular
 *  DM as a live-location start / end marker rather than a snapshot. */
export const LIVE_START_HEADER = '[live-location:start]';
export const LIVE_END_HEADER = '[live-location:end]';

export type LiveLocationPhase = 'start' | 'end';

export interface LiveLocationMarker {
  phase: LiveLocationPhase;
  sessionId: string;
  /** Total intended duration in milliseconds. Always present on `start`,
   *  optional (last-known value) on `end` so the receiver can show the
   *  chosen window even after the share has wrapped up. */
  durationMs: number;
  /** Wall-clock epoch (ms) the sender started the share. */
  startedAt: number;
  /** Initial (start) or final (end) coordinates the sender published. */
  location: SharedLocation;
}

/**
 * Format a "Live location share started" DM. Embeds the `geo:` URI so
 * old clients (and our own pre-#206 snapshot path) still render a
 * location card; a `[live-location:start]` sentinel + JSON block sit
 * above so receivers running this version recognise it as a live share.
 */
export function formatLiveStartMessage(input: {
  sessionId: string;
  durationMs: number;
  startedAt: number;
  location: SharedLocation;
}): string {
  const meta = JSON.stringify({
    sessionId: input.sessionId,
    durationMs: input.durationMs,
    startedAt: input.startedAt,
  });
  // The `geo:` URI lives inside `formatGeoMessage`'s fenced block so
  // existing clients render the start coordinates as a static map.
  return [LIVE_START_HEADER, meta, formatGeoMessage(input.location)].join('\n');
}

/**
 * Format a "Live location share ended" DM. Same shape as the start
 * marker, with the final known coordinates so the receiver's bubble
 * can pin to the last position.
 */
export function formatLiveEndMessage(input: {
  sessionId: string;
  durationMs: number;
  startedAt: number;
  location: SharedLocation;
}): string {
  const meta = JSON.stringify({
    sessionId: input.sessionId,
    durationMs: input.durationMs,
    startedAt: input.startedAt,
  });
  return [LIVE_END_HEADER, meta, formatGeoMessage(input.location)].join('\n');
}

const COORD_RE = /\bgeo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:;u=(\d+(?:\.\d+)?))?/i;

/**
 * Try to parse a DM body as a live-location start / end marker. Returns
 * `null` if the body doesn't carry the sentinel header — caller can
 * safely fall through to plain `parseGeoMessage` for snapshot shares.
 *
 * Keeps the geo-URI parse tolerant: if the JSON metadata block is
 * missing / corrupt we still salvage the coordinates so the receiver
 * sees *something* in their thread rather than a crashed bubble.
 */
export function parseLiveLocationMarker(text: string): LiveLocationMarker | null {
  if (!text) return null;
  let phase: LiveLocationPhase;
  if (text.includes(LIVE_START_HEADER)) phase = 'start';
  else if (text.includes(LIVE_END_HEADER)) phase = 'end';
  else return null;

  const coordMatch = text.match(COORD_RE);
  if (!coordMatch) return null;
  const lat = Number(coordMatch[1]);
  const lon = Number(coordMatch[2]);
  if (!isFinite(lat) || !isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  let accuracyMeters: number | null = null;
  if (coordMatch[3] !== undefined) {
    const n = Number(coordMatch[3]);
    if (isFinite(n) && n >= 0 && n < 40_000_000) accuracyMeters = Math.round(n);
  }

  // Best-effort metadata parse. A truncated / re-encoded message could
  // strip the JSON line, so we fall back to deterministic defaults.
  let sessionId = '';
  let durationMs = 0;
  let startedAt = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed) as {
        sessionId?: unknown;
        durationMs?: unknown;
        startedAt?: unknown;
      };
      if (typeof parsed.sessionId === 'string') sessionId = parsed.sessionId;
      if (typeof parsed.durationMs === 'number' && isFinite(parsed.durationMs)) {
        durationMs = Math.max(0, Math.min(MAX_DURATION_MS, Math.round(parsed.durationMs)));
      }
      if (typeof parsed.startedAt === 'number' && isFinite(parsed.startedAt)) {
        startedAt = Math.round(parsed.startedAt);
      }
      break;
    } catch {
      // Ignore — try next line / fall through to defaults.
    }
  }
  return {
    phase,
    sessionId,
    durationMs,
    startedAt,
    location: { lat, lon, accuracyMeters },
  };
}

export interface LivePingPayload {
  /** Latitude in decimal degrees. */
  lat: number;
  /** Longitude in decimal degrees. */
  lon: number;
  /** GPS accuracy in metres. `null` if the OS didn't supply it. */
  accuracy: number | null;
  /** Direction of travel in degrees (0-360, 0 = north). `null` when stationary. */
  heading: number | null;
  /** Wall-clock epoch (ms) the sample was captured. */
  ts: number;
  /** Live-share session id this ping belongs to. */
  sessionId: string;
}

/**
 * Encode a coordinate sample as the JSON content of a kind-20069 ping.
 * Caller is responsible for NIP-04 encrypting the result before publish.
 */
export function encodeLivePingPayload(payload: LivePingPayload): string {
  return JSON.stringify(payload);
}

/**
 * Decode the plaintext content of a decrypted kind-20069 ping. Returns
 * `null` for malformed / out-of-range input rather than throwing — a
 * single bad ping should not kill the live-share viewer.
 */
export function decodeLivePingPayload(plaintext: string): LivePingPayload | null {
  let raw: unknown;
  try {
    raw = JSON.parse(plaintext);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const lat = typeof r.lat === 'number' ? r.lat : NaN;
  const lon = typeof r.lon === 'number' ? r.lon : NaN;
  if (!isFinite(lat) || !isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const sessionId = typeof r.sessionId === 'string' ? r.sessionId : '';
  if (!sessionId) return null;
  const accuracy = typeof r.accuracy === 'number' && isFinite(r.accuracy) ? r.accuracy : null;
  const heading = typeof r.heading === 'number' && isFinite(r.heading) ? r.heading : null;
  const ts = typeof r.ts === 'number' && isFinite(r.ts) ? r.ts : Date.now();
  return { lat, lon, accuracy, heading, ts, sessionId };
}

/**
 * Generate a short opaque session id. Hex-encoded random bytes — long
 * enough that the `['d', sessionId]` filter on the relay won't collide
 * with another concurrent share.
 *
 * Pure function (no React Native dependency) so the unit tests can
 * exercise it without polyfills. `crypto.getRandomValues` is provided
 * by `react-native-get-random-values` (loaded via `polyfills.ts`) on
 * device, and by Node's webcrypto in the Jest preset.
 */
export function newSessionId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute the wall-clock instant a session expires. Capped at
 * `MAX_DURATION_MS` so a buggy / hostile sender can't request a 24-hour
 * watch that drains the receiver's battery rendering bubbles.
 */
export function expiryFor(startedAt: number, durationMs: number): number {
  const capped = Math.max(0, Math.min(MAX_DURATION_MS, durationMs));
  return startedAt + capped;
}

/** Convenience: build the OSM URL for the current ping. */
export function pingOsmUrl(payload: LivePingPayload): string {
  return buildOsmViewUrl({ lat: payload.lat, lon: payload.lon, accuracyMeters: payload.accuracy });
}
