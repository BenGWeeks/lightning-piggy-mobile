/**
 * When to send a live-location coordinate update, and the per-session
 * dispatcher that applies it (#1300). Pure — no React, no expo-location — so
 * the cadence, in-flight and expiry rules are unit-testable, and the same
 * dispatcher serves the foreground provider and the headless background task.
 *
 * Cadence: an update goes out when the sharer has moved ≥ 25 m and ≥ 30 s
 * have passed since the last one, or as a heartbeat when they're still (so
 * the receiver's "Updated x ago" stays honest). Marmot's heartbeat is slower:
 * each Marmot update is a kind-445 event relays store, while a NIP-17 update
 * is an ephemeral event they drop. Worst case (moving non-stop for 8 h) is
 * 960 updates; stationary for 8 h, 96 on Marmot.
 */

import { haversineMetres } from '../utils/geohash';
import { expiryFor, type LivePingPayload } from './liveLocationService';
import type { SharedLocation } from './locationService';
import type { OutgoingSession } from './liveLocationStateMachine';

export const LIVE_UPDATE_MIN_INTERVAL_MS = 30_000;
export const LIVE_UPDATE_MIN_DISTANCE_M = 25;
export const LIVE_UPDATE_HEARTBEAT_MS = { marmot: 5 * 60_000, nip17: 2 * 60_000 } as const;

export type LiveTransport = 'marmot' | 'nip17';

/** Marmot for Marmot 1:1s and groups; NIP-17 otherwise. */
export const transportFor = (s: Pick<OutgoingSession, 'protocol' | 'groupId'>): LiveTransport =>
  s.groupId || s.protocol === 'marmot' ? 'marmot' : 'nip17';

export interface LastSent {
  at: number;
  location: SharedLocation;
}

export function shouldSendUpdate(input: {
  now: number;
  last: LastSent | null;
  location: SharedLocation;
  transport: LiveTransport;
}): boolean {
  const { now, last, location, transport } = input;
  if (!last) return true;
  const elapsed = now - last.at;
  if (elapsed >= LIVE_UPDATE_HEARTBEAT_MS[transport]) return true;
  if (elapsed < LIVE_UPDATE_MIN_INTERVAL_MS) return false;
  return haversineMetres(last.location, location) >= LIVE_UPDATE_MIN_DISTANCE_M;
}

export interface TrackedFix {
  location: SharedLocation;
  heading: number | null;
  /** Capture time (ms). */
  ts: number;
}

export type SendLiveUpdate = (
  session: OutgoingSession,
  payload: LivePingPayload,
) => Promise<boolean>;

/**
 * Per-session send state: when + where the last update went, and which
 * sessions have a send in flight. A fix arriving while a session's send is
 * still running is dropped (never queued), so a slow relay can't build a
 * backlog on the JS thread.
 */
export function createLiveUpdateDispatcher() {
  const last = new Map<string, LastSent>();
  const inFlight = new Set<string>();

  return {
    /** Seed a new share with its start fix (the start marker carried it). */
    seed(sessionId: string, location: SharedLocation, at: number): void {
      last.set(sessionId, { at, location });
    },
    forget(sessionId: string): void {
      last.delete(sessionId);
      inFlight.delete(sessionId);
    },
    reset(): void {
      last.clear();
      inFlight.clear();
    },
    /**
     * Offer a fix to every active, unexpired session; sends where the cadence
     * allows. Resolves with the ids whose update a relay accepted.
     */
    async handleFix(
      fix: TrackedFix,
      sessions: Iterable<OutgoingSession>,
      send: SendLiveUpdate,
      now: number = Date.now(),
    ): Promise<string[]> {
      const sends: Promise<string | null>[] = [];
      for (const session of sessions) {
        const id = session.sessionId;
        if (session.status !== 'active' || !session.startMarkerSent) continue;
        if (now >= expiryFor(session.startedAt, session.durationMs)) continue;
        if (inFlight.has(id)) continue;
        const transport = transportFor(session);
        if (
          !shouldSendUpdate({ now, last: last.get(id) ?? null, location: fix.location, transport })
        ) {
          continue;
        }
        inFlight.add(id);
        const payload: LivePingPayload = {
          lat: fix.location.lat,
          lon: fix.location.lon,
          accuracy: fix.location.accuracyMeters,
          heading: fix.heading,
          ts: fix.ts,
          sessionId: id,
        };
        sends.push(
          send(session, payload)
            .catch(() => false)
            .then((ok) => {
              inFlight.delete(id);
              if (!ok) return null;
              last.set(id, { at: now, location: fix.location });
              return id;
            }),
        );
      }
      const done = await Promise.all(sends);
      return done.filter((id): id is string => id !== null);
    },
  };
}

export type LiveUpdateDispatcher = ReturnType<typeof createLiveUpdateDispatcher>;
