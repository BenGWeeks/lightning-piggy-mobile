/**
 * Coalesced receive-side store for live-location coordinate updates (#1300).
 *
 * Every transport feeds it — NIP-17 session-key updates and legacy NIP-04
 * pings off the relays, Marmot kind-20069 app events out of MLS — and every
 * viewer reads it (the conversation bubble, the group bubble, the Full Map).
 * Keeps only the latest fix per (sender, session), drops stale / duplicate
 * updates, and notifies subscribers in ONE flush per ≤150 ms burst, so a
 * relay replay or a busy group never becomes a setState storm (CLAUDE.md
 * performance rules). Pure module state — no React — so it is unit-testable
 * and reachable from the Marmot listener, which has no component.
 *
 * Keyed by sender AND session: a viewer looks updates up with the sender of
 * the start marker it trusts, so another group member re-using a session id
 * can never move someone else's marker.
 */

import type { SharedLocation } from '../utils/geoMessage';
import type { LivePingPayload } from './liveLocationService';

export interface LiveUpdate {
  location: SharedLocation;
  /** Sender's capture time (ms) — orders updates. */
  ts: number;
}

export const LIVE_UPDATE_FLUSH_MS = 150;
/** Bound on retained sessions — an 8 h cap means few are ever live at once. */
const MAX_ENTRIES = 256;

const latest = new Map<string, LiveUpdate>();
const listeners = new Set<() => void>();
let version = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** A live session's identity: its owner's pubkey + its session id. */
export const liveKey = (sender: string, sessionId: string) =>
  `${sender.toLowerCase()}:${sessionId}`;
const keyFor = liveKey;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    version += 1;
    for (const l of [...listeners]) l();
  }, LIVE_UPDATE_FLUSH_MS);
}

/**
 * Record an update from `sender` (hex pubkey of the share's owner). Returns
 * false when it was stale or a duplicate (and so changes nothing).
 */
export function ingestLiveUpdate(sender: string, payload: LivePingPayload): boolean {
  const key = keyFor(sender, payload.sessionId);
  const prev = latest.get(key);
  if (prev && prev.ts >= payload.ts) return false;
  // Re-insert so Map order tracks recency, then evict the oldest beyond the cap.
  latest.delete(key);
  latest.set(key, {
    location: { lat: payload.lat, lon: payload.lon, accuracyMeters: payload.accuracy },
    ts: payload.ts,
  });
  while (latest.size > MAX_ENTRIES) latest.delete(latest.keys().next().value as string);
  scheduleFlush();
  return true;
}

/** Latest update for one session from its trusted sender, if any. */
export function getLiveUpdate(sender: string, sessionId: string): LiveUpdate | undefined {
  return latest.get(keyFor(sender, sessionId));
}

/** Monotonic counter bumped once per flush — the useSyncExternalStore snapshot. */
export function getLiveUpdatesVersion(): number {
  return version;
}

export function subscribeLiveUpdates(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Forget everything (sign-out / account switch, and tests). */
export function clearLiveUpdates(): void {
  latest.clear();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  version += 1;
  for (const l of [...listeners]) l();
}
