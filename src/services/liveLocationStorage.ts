/**
 * Persistence for the live-location share state machine. We store the
 * minimal set of fields needed to either (a) resume a session if the
 * app comes back before the wall-clock expiry, or (b) publish a final
 * "share interrupted" marker on next launch when resume isn't possible.
 *
 * AsyncStorage (not SecureStore) — coordinates aren't credentials, and
 * the storage cap on iOS Keychain is too small for an unbounded session
 * map. We keep the on-disk record small and bound the active-session
 * count anyway via the state machine.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OutgoingSession } from './liveLocationStateMachine';

const STORAGE_KEY = 'live_location_sessions_v1';

interface PersistedSession {
  sessionId: string;
  recipientPubkey: string;
  startedAt: number;
  durationMs: number;
  startMarkerSent: boolean;
  endMarkerSent: boolean;
}

/**
 * Read the persisted sessions back into in-memory shape. Sessions that
 * are already past expiry are preserved (the owner inspects them and
 * decides whether to publish a "share interrupted" final marker), but
 * sessions that already have `endMarkerSent: true` are dropped — they
 * served their purpose on the previous run.
 */
export async function loadPersistedSessions(): Promise<OutgoingSession[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: OutgoingSession[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      if (
        typeof e.sessionId !== 'string' ||
        typeof e.recipientPubkey !== 'string' ||
        typeof e.startedAt !== 'number' ||
        typeof e.durationMs !== 'number'
      ) {
        continue;
      }
      const startMarkerSent = e.startMarkerSent === true;
      const endMarkerSent = e.endMarkerSent === true;
      if (endMarkerSent) continue;
      out.push({
        sessionId: e.sessionId,
        recipientPubkey: e.recipientPubkey,
        startedAt: e.startedAt,
        durationMs: e.durationMs,
        lastPingAt: null,
        // Restore in `paused` so the owner makes an explicit
        // resume/expire decision before the watcher starts again.
        status: 'paused',
        startMarkerSent,
        endMarkerSent,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Persist the current session map. Called best-effort whenever the
 * state machine produces a meaningful transition — failure is logged
 * but doesn't block the in-memory state.
 */
export async function savePersistedSessions(sessions: Iterable<OutgoingSession>): Promise<void> {
  const persisted: PersistedSession[] = [];
  for (const session of sessions) {
    // Already-ended sessions don't need to survive a restart.
    if (session.status === 'ended') continue;
    persisted.push({
      sessionId: session.sessionId,
      recipientPubkey: session.recipientPubkey,
      startedAt: session.startedAt,
      durationMs: session.durationMs,
      startMarkerSent: session.startMarkerSent,
      endMarkerSent: session.endMarkerSent,
    });
  }
  try {
    if (persisted.length === 0) {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } else {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    }
  } catch {
    // Best-effort — if AsyncStorage is full, the watcher still works
    // for the current session, just won't survive a hard kill.
  }
}
