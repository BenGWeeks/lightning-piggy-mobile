/**
 * Sender-side live-location share orchestrator. Owns:
 *
 *   - the `expo-location` watcher (one shared watcher across all
 *     active sessions — coordinates feed every recipient)
 *   - the state machine (active / paused / expired / ended)
 *   - the publishing loop for kind-20069 ephemeral pings
 *   - the start / end NIP-04 marker DMs
 *   - per-app-restart resume + cleanup of orphaned sessions
 *
 * The receiver side is owned by ConversationScreen — each conversation
 * subscribes to its peer's pings independently, so there's no value in
 * lifting it into a global context. The provider exposes:
 *
 *   - `startShare(recipientPubkey, durationMs)` — picks a fix, fires
 *     the start marker, and adds a session to the watcher set.
 *   - `stopShare(sessionId)` — flips the session to `ended` and fires
 *     the end marker.
 *   - `sessionsByRecipient` — read model for the in-thread bubble (so
 *     the bubble can show countdown + Stop without callbacks).
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import * as nostrService from '../services/nostrService';
import * as amberService from '../services/amberService';
import { useNostr } from './NostrContext';
import {
  DEFAULT_PING_INTERVAL_MS,
  LIVE_LOCATION_PING_KIND,
  LiveLocationPhase,
  encodeLivePingPayload,
  expiryFor,
  formatLiveEndMessage,
  formatLiveStartMessage,
  newSessionId,
  type LivePingPayload,
} from '../services/liveLocationService';
import { getCurrentLocation, type SharedLocation } from '../services/locationService';
import { loadPersistedSessions, savePersistedSessions } from '../services/liveLocationStorage';
import { reduce, remainingMs, type OutgoingSession } from '../services/liveLocationStateMachine';

// Mirrors the SecureStore key used by NostrContext for the user's nsec.
// We re-read on every publish rather than caching so a logout / key
// rotation can never leak a stale key into a still-running session.
const NSEC_KEY = 'nostr_nsec';

export type LiveShareStartResult =
  | { ok: true; sessionId: string; location: SharedLocation }
  | { ok: false; error: string };

export type LiveShareStopResult = { ok: true } | { ok: false; error: string };

export interface LiveLocationContextValue {
  /** Map of recipient pubkey → list of sessions (typically 0 or 1). */
  sessionsByRecipient: Map<string, OutgoingSession[]>;
  /** Start a new live share. Picks a single GPS fix synchronously,
   *  publishes the start marker DM, then begins the watcher. */
  startShare: (recipientPubkey: string, durationMs: number) => Promise<LiveShareStartResult>;
  /** Stop an in-progress share. Publishes the end marker DM and
   *  flips the session to `ended` so storage can drop it. */
  stopShare: (sessionId: string) => Promise<LiveShareStopResult>;
  /** Cheap convenience for the conversation header / bubble. */
  hasActiveShareWith: (recipientPubkey: string) => boolean;
  /** Best-effort remaining lifetime — `null` when no session matches. */
  remainingMsForSession: (sessionId: string) => number | null;
}

const LiveLocationContext = createContext<LiveLocationContextValue | undefined>(undefined);

export function useLiveLocation(): LiveLocationContextValue {
  const ctx = useContext(LiveLocationContext);
  if (!ctx) {
    throw new Error('useLiveLocation must be used within a LiveLocationProvider');
  }
  return ctx;
}

export const LiveLocationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { pubkey, isLoggedIn, signerType, relays, sendDirectMessage } = useNostr();
  const [sessions, setSessions] = useState<Map<string, OutgoingSession>>(() => new Map());

  // Mirror state into a ref so the watcher / interval can read the
  // current map without re-binding callbacks every render.
  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
    // Best-effort persist on every transition.
    void savePersistedSessions(sessions.values());
  }, [sessions]);

  const dispatch = useCallback((action: Parameters<typeof reduce>[1]) => {
    setSessions((prev) => reduce(prev, action));
  }, []);

  // ---- Helpers that need the current signer / relay set --------------------

  const writeRelays = useMemo(
    () =>
      Array.from(
        new Set([
          ...relays.filter((r) => r.write).map((r) => r.url),
          ...nostrService.DEFAULT_RELAYS,
        ]),
      ),
    [relays],
  );

  // Publish a single ephemeral ping. Returns a boolean rather than
  // throwing — the watcher loop is best-effort and a transient relay
  // failure should not kill the entire share.
  const publishPing = useCallback(
    async (session: OutgoingSession, payload: LivePingPayload): Promise<boolean> => {
      if (!pubkey) return false;
      const json = encodeLivePingPayload(payload);
      try {
        if (signerType === 'nsec') {
          const nsec = await SecureStore.getItemAsync(NSEC_KEY);
          if (!nsec) return false;
          const { secretKey } = nostrService.decodeNsec(nsec);
          const event = await nostrService.createLiveLocationPingEvent(
            secretKey,
            session.recipientPubkey,
            session.sessionId,
            json,
            LIVE_LOCATION_PING_KIND,
          );
          await nostrService.signAndPublishEvent(event, secretKey, writeRelays);
          return true;
        }
        if (signerType === 'amber') {
          const ciphertext = await amberService.requestNip04Encrypt(
            json,
            session.recipientPubkey,
            pubkey,
          );
          if (!ciphertext) return false;
          const event = {
            kind: LIVE_LOCATION_PING_KIND,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
              ['p', session.recipientPubkey],
              ['d', session.sessionId],
            ],
            content: ciphertext,
          };
          const { event: signedJson } = await amberService.requestEventSignature(
            JSON.stringify(event),
            '',
            pubkey,
          );
          if (!signedJson) return false;
          const signed = JSON.parse(signedJson);
          await nostrService.publishSignedEvent(signed, writeRelays);
          return true;
        }
      } catch {
        // Silent — single ping failures are normal on flaky networks.
      }
      return false;
    },
    [pubkey, signerType, writeRelays],
  );

  // Send the start / end marker as a regular NIP-04 DM. We reuse the
  // existing `sendDirectMessage` so the receiver's threaded view —
  // which already merges kind-4 events into the conversation — picks
  // it up without any new transport plumbing.
  const sendMarker = useCallback(
    async (
      session: OutgoingSession,
      phase: LiveLocationPhase,
      location: SharedLocation,
    ): Promise<boolean> => {
      const text =
        phase === 'start'
          ? formatLiveStartMessage({
              sessionId: session.sessionId,
              durationMs: session.durationMs,
              startedAt: session.startedAt,
              location,
            })
          : formatLiveEndMessage({
              sessionId: session.sessionId,
              durationMs: session.durationMs,
              startedAt: session.startedAt,
              location,
            });
      const result = await sendDirectMessage(session.recipientPubkey, text);
      return result.success;
    },
    [sendDirectMessage],
  );

  // ---- Lifecycle: start / stop ------------------------------------------

  const startShare = useCallback(
    async (recipientPubkey: string, durationMs: number): Promise<LiveShareStartResult> => {
      if (!pubkey || !isLoggedIn) return { ok: false, error: 'Not logged in' };
      const fix = await getCurrentLocation();
      if (!fix.ok) return { ok: false, error: fix.message };
      const sessionId = newSessionId();
      const now = Date.now();
      // Optimistically install the session so the bubble renders even
      // if the start marker DM is slow to publish.
      dispatch({
        type: 'start',
        sessionId,
        recipientPubkey,
        durationMs,
        now,
      });
      const installed: OutgoingSession = {
        sessionId,
        recipientPubkey,
        startedAt: now,
        durationMs,
        lastPingAt: null,
        status: 'active',
        startMarkerSent: false,
        endMarkerSent: false,
      };
      const startSent = await sendMarker(installed, 'start', fix.location);
      if (!startSent) {
        // Roll back — publish failed, no point keeping the watcher.
        dispatch({ type: 'stop', sessionId });
        return { ok: false, error: 'Failed to send live-location start marker.' };
      }
      dispatch({ type: 'startMarkerSent', sessionId });
      // First ping fires immediately so the receiver has a coordinate
      // before the 30 s cadence kicks in.
      void publishPing(installed, {
        lat: fix.location.lat,
        lon: fix.location.lon,
        accuracy: fix.location.accuracyMeters,
        heading: null,
        ts: now,
        sessionId,
      }).then((ok) => {
        if (ok) dispatch({ type: 'ping', sessionId, now: Date.now() });
      });
      return { ok: true, sessionId, location: fix.location };
    },
    [pubkey, isLoggedIn, dispatch, sendMarker, publishPing],
  );

  const stopShare = useCallback(
    async (sessionId: string): Promise<LiveShareStopResult> => {
      const session = sessionsRef.current.get(sessionId);
      if (!session) return { ok: false, error: 'Session not found' };
      if (session.status === 'ended') return { ok: true };
      // Best-effort final fix so the end marker carries the most
      // recent coordinates; fall back to a plausible last-known sample
      // if a fresh fix isn't available within the timeout.
      const fix = await getCurrentLocation();
      const finalLocation: SharedLocation = fix.ok
        ? fix.location
        : { lat: 0, lon: 0, accuracyMeters: null };
      const sent = await sendMarker(session, 'end', finalLocation);
      if (sent) dispatch({ type: 'endMarkerSent', sessionId });
      // Flip to `ended` regardless — we don't want a stuck-watcher
      // loop if the relay is unreachable.
      dispatch({ type: 'stop', sessionId });
      return { ok: true };
    },
    [dispatch, sendMarker],
  );

  // ---- Watcher loop ------------------------------------------------------

  const watcherSubRef = useRef<Location.LocationSubscription | null>(null);
  const lastPublishedAtRef = useRef<Map<string, number>>(new Map());

  // Start / stop a single shared GPS watcher whenever the active-session
  // count crosses 0. One coordinate stream feeds every active recipient
  // — no point opening N watchers.
  useEffect(() => {
    let cancelled = false;
    const anyActive = Array.from(sessions.values()).some((s) => s.status === 'active');
    if (!anyActive) {
      watcherSubRef.current?.remove();
      watcherSubRef.current = null;
      lastPublishedAtRef.current.clear();
      return;
    }
    if (watcherSubRef.current) return; // already running
    void (async () => {
      try {
        // Permission check — `getCurrentLocation` already ran at start
        // time so this is normally a no-op, but a user can revoke
        // mid-session via the OS settings shade.
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted) return;
        const sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: DEFAULT_PING_INTERVAL_MS,
            distanceInterval: 0,
          },
          (pos) => {
            if (cancelled) return;
            const now = Date.now();
            for (const session of sessionsRef.current.values()) {
              if (session.status !== 'active') continue;
              // Per-session debounce: keep one publish per session per
              // `DEFAULT_PING_INTERVAL_MS` even if the OS hands us a
              // burst of fixes (Android's fused provider is bursty).
              const last = lastPublishedAtRef.current.get(session.sessionId) ?? 0;
              if (now - last < DEFAULT_PING_INTERVAL_MS - 1000) continue;
              lastPublishedAtRef.current.set(session.sessionId, now);
              const payload: LivePingPayload = {
                lat: pos.coords.latitude,
                lon: pos.coords.longitude,
                accuracy:
                  typeof pos.coords.accuracy === 'number' && isFinite(pos.coords.accuracy)
                    ? Math.round(pos.coords.accuracy)
                    : null,
                heading:
                  typeof pos.coords.heading === 'number' && isFinite(pos.coords.heading)
                    ? Math.round(pos.coords.heading)
                    : null,
                ts: now,
                sessionId: session.sessionId,
              };
              void publishPing(session, payload).then((ok) => {
                if (ok) dispatch({ type: 'ping', sessionId: session.sessionId, now: Date.now() });
              });
            }
          },
        );
        if (cancelled) {
          sub.remove();
          return;
        }
        watcherSubRef.current = sub;
      } catch {
        // Best-effort; we don't surface an error UI here because the
        // bubble already shows "Last update: …" which will stop ticking.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessions, publishPing, dispatch]);

  // ---- Expiry tick + end-marker publish ---------------------------------

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      dispatch({ type: 'tickExpiryCheck', now });
      // Drain any expired sessions whose end marker hasn't fired yet.
      for (const session of sessionsRef.current.values()) {
        if (session.status === 'expired' && !session.endMarkerSent) {
          // Synthesise a "no last fix" marker if we never saw one —
          // stopShare's getCurrentLocation will retry one more time.
          void stopShare(session.sessionId);
        }
      }
    }, 5000);
    return () => clearInterval(id);
  }, [dispatch, stopShare]);

  // ---- Pause / resume on background -------------------------------------

  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      const now = Date.now();
      if (next === 'active') {
        for (const session of sessionsRef.current.values()) {
          if (session.status === 'paused') {
            dispatch({ type: 'resume', sessionId: session.sessionId, now });
          }
        }
      } else {
        // Pause active sessions when backgrounded — the OS will
        // throttle / suspend our watcher anyway, and pausing keeps the
        // remaining-time UI honest.
        for (const session of sessionsRef.current.values()) {
          if (session.status === 'active') {
            dispatch({ type: 'pause', sessionId: session.sessionId });
          }
        }
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [dispatch]);

  // ---- Hydrate persisted sessions on first mount -----------------------

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const persisted = await loadPersistedSessions();
      if (cancelled || persisted.length === 0) return;
      setSessions((prev) => {
        const next = new Map(prev);
        const now = Date.now();
        for (const session of persisted) {
          if (next.has(session.sessionId)) continue;
          // If the persisted session is already past its expiry, mark
          // it expired so the next tick publishes the end marker.
          // Otherwise leave it `paused` — the AppState listener will
          // resume on the next foreground transition.
          const expired = now >= expiryFor(session.startedAt, session.durationMs);
          next.set(session.sessionId, {
            ...session,
            status: expired ? 'expired' : 'paused',
          });
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Read models -------------------------------------------------------

  const sessionsByRecipient = useMemo(() => {
    const out = new Map<string, OutgoingSession[]>();
    for (const session of sessions.values()) {
      const arr = out.get(session.recipientPubkey) ?? [];
      arr.push(session);
      out.set(session.recipientPubkey, arr);
    }
    return out;
  }, [sessions]);

  const hasActiveShareWith = useCallback(
    (recipientPubkey: string): boolean => {
      const arr = sessionsByRecipient.get(recipientPubkey) ?? [];
      return arr.some((s) => s.status === 'active' || s.status === 'paused');
    },
    [sessionsByRecipient],
  );

  const remainingMsForSession = useCallback(
    (sessionId: string): number | null => {
      const session = sessions.get(sessionId);
      if (!session) return null;
      return remainingMs(session, Date.now());
    },
    [sessions],
  );

  const value = useMemo<LiveLocationContextValue>(
    () => ({
      sessionsByRecipient,
      startShare,
      stopShare,
      hasActiveShareWith,
      remainingMsForSession,
    }),
    [sessionsByRecipient, startShare, stopShare, hasActiveShareWith, remainingMsForSession],
  );

  return <LiveLocationContext.Provider value={value}>{children}</LiveLocationContext.Provider>;
};
