/**
 * Live-location share state machine — pure functional core, no React,
 * no expo-location. The owning context drives the side-effects (start
 * the watcher / publish a ping / write storage); this module decides
 * *what* should happen given the current state and an incoming event.
 *
 * Keeping the transitions pure means the unit tests can exercise the
 * full lifecycle (start → ping → pause → resume → expire → stop)
 * without faking out the GPS or relay layers.
 */

import { MAX_DURATION_MS } from './liveLocationService';

export type SessionStatus =
  /** Watcher running, pings being published. */
  | 'active'
  /** Watcher paused — typically because the app was backgrounded for
   *  longer than `pauseAfterBackgroundMs` or the OS suspended us. */
  | 'paused'
  /** Wall-clock expiry passed. The owner should publish the final
   *  end-of-share marker once and then transition to `ended`. */
  | 'expired'
  /** Final state — user stopped manually OR end-marker already sent
   *  for an expired session. The session can be removed from storage. */
  | 'ended';

export interface OutgoingSession {
  /** Opaque id minted by `newSessionId`. Same id appears on every
   *  kind-20069 ping for this share, so the receiver can filter. */
  sessionId: string;
  /** Recipient's hex pubkey. */
  recipientPubkey: string;
  /** Wall-clock epoch (ms) the share was kicked off. */
  startedAt: number;
  /** Total intended duration (ms). Capped at `MAX_DURATION_MS`. */
  durationMs: number;
  /** Last successful ping (or the start coords if no ping yet). */
  lastPingAt: number | null;
  /** Current status — see `SessionStatus`. */
  status: SessionStatus;
  /** True once the start marker DM has been sent. We don't retry on
   *  failure — the user sees the error in the UI and decides. */
  startMarkerSent: boolean;
  /** True once the end marker DM has been sent. Prevents double-ends
   *  when a manual stop races with the expiry timer. */
  endMarkerSent: boolean;
}

export type Action =
  /** Sender requested to start a new share. The owning context mints
   *  the sessionId and supplies the snapshot coords. */
  | {
      type: 'start';
      sessionId: string;
      recipientPubkey: string;
      durationMs: number;
      now: number;
    }
  /** A coordinate ping just published — bumps `lastPingAt`. */
  | { type: 'ping'; sessionId: string; now: number }
  /** Caller noticed wall-clock has passed expiry; flip status to
   *  `expired` so the owner can publish the final end marker. */
  | { type: 'tickExpiryCheck'; now: number }
  /** App went to background or watcher errored — pause without ending. */
  | { type: 'pause'; sessionId: string }
  /** App returned to foreground — resume an existing paused session
   *  if it hasn't yet expired. */
  | { type: 'resume'; sessionId: string; now: number }
  /** User tapped Stop, OR end marker has been published for an
   *  expired session. Marks the session terminal. */
  | { type: 'stop'; sessionId: string }
  /** End marker just landed on a relay — flip the flag so we don't
   *  re-send. Distinct from `stop` so `expired → markerSent → ended`
   *  is a deliberate two-step. */
  | { type: 'endMarkerSent'; sessionId: string }
  /** Same idea for the start marker. Ordered before any pings can fire. */
  | { type: 'startMarkerSent'; sessionId: string };

/**
 * Apply an action to the session map. Returns a new map (never mutates
 * the input) so React state updates work the obvious way.
 */
export function reduce(
  state: Map<string, OutgoingSession>,
  action: Action,
): Map<string, OutgoingSession> {
  switch (action.type) {
    case 'start': {
      const next = new Map(state);
      const durationMs = Math.max(0, Math.min(MAX_DURATION_MS, action.durationMs));
      next.set(action.sessionId, {
        sessionId: action.sessionId,
        recipientPubkey: action.recipientPubkey,
        startedAt: action.now,
        durationMs,
        lastPingAt: null,
        status: 'active',
        startMarkerSent: false,
        endMarkerSent: false,
      });
      return next;
    }
    case 'startMarkerSent': {
      const session = state.get(action.sessionId);
      if (!session) return state;
      const next = new Map(state);
      next.set(action.sessionId, { ...session, startMarkerSent: true });
      return next;
    }
    case 'ping': {
      const session = state.get(action.sessionId);
      if (!session) return state;
      // Don't update lastPingAt for sessions that have already moved
      // past `active` — a stray ping arriving after stop/expire would
      // otherwise reset our "last update" time and confuse the UI.
      if (session.status !== 'active') return state;
      const next = new Map(state);
      next.set(action.sessionId, { ...session, lastPingAt: action.now });
      return next;
    }
    case 'tickExpiryCheck': {
      let mutated = false;
      const next = new Map(state);
      for (const [id, session] of state) {
        if (session.status !== 'active' && session.status !== 'paused') continue;
        const expiresAt = session.startedAt + session.durationMs;
        if (action.now >= expiresAt) {
          next.set(id, { ...session, status: 'expired' });
          mutated = true;
        }
      }
      return mutated ? next : state;
    }
    case 'pause': {
      const session = state.get(action.sessionId);
      if (!session) return state;
      if (session.status !== 'active') return state;
      const next = new Map(state);
      next.set(action.sessionId, { ...session, status: 'paused' });
      return next;
    }
    case 'resume': {
      const session = state.get(action.sessionId);
      if (!session) return state;
      if (session.status !== 'paused') return state;
      // If we were paused past expiry, flip straight to expired so
      // the owner publishes the final marker on the next tick.
      const expiresAt = session.startedAt + session.durationMs;
      const status: SessionStatus = action.now >= expiresAt ? 'expired' : 'active';
      const next = new Map(state);
      next.set(action.sessionId, { ...session, status });
      return next;
    }
    case 'endMarkerSent': {
      const session = state.get(action.sessionId);
      if (!session) return state;
      const next = new Map(state);
      next.set(action.sessionId, { ...session, endMarkerSent: true });
      return next;
    }
    case 'stop': {
      const session = state.get(action.sessionId);
      if (!session) return state;
      if (session.status === 'ended') return state;
      const next = new Map(state);
      next.set(action.sessionId, { ...session, status: 'ended' });
      return next;
    }
  }
}

/**
 * Returns the sessions whose wall-clock window is still open. Used by
 * the owner to decide whether to keep the GPS watcher running.
 */
export function activeSessions(state: Map<string, OutgoingSession>): OutgoingSession[] {
  const out: OutgoingSession[] = [];
  for (const session of state.values()) {
    if (session.status === 'active') out.push(session);
  }
  return out;
}

/**
 * Sessions that have just hit `expired` and still need their end
 * marker published. The owner drains this list on each tick.
 */
export function pendingEndMarkers(state: Map<string, OutgoingSession>): OutgoingSession[] {
  const out: OutgoingSession[] = [];
  for (const session of state.values()) {
    if (session.status === 'expired' && !session.endMarkerSent) out.push(session);
  }
  return out;
}

/** Wall-clock expiry instant for a session. */
export function expiresAt(session: OutgoingSession): number {
  return session.startedAt + session.durationMs;
}

/** Remaining lifetime in ms (clamped to ≥ 0). */
export function remainingMs(session: OutgoingSession, now: number): number {
  return Math.max(0, expiresAt(session) - now);
}
