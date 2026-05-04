/**
 * Unit tests for the live-location share state machine. These cover
 * the lifecycle (start → ping → expire / stop) plus the pause /
 * resume edge cases that surface when the app is backgrounded.
 *
 * Pure-function tests — no React, no expo-location, no relay mocks.
 */

import {
  reduce,
  activeSessions,
  pendingEndMarkers,
  remainingMs,
  expiresAt,
  type OutgoingSession,
} from './liveLocationStateMachine';

const RECIPIENT = 'a'.repeat(64);

function emptyState(): Map<string, OutgoingSession> {
  return new Map();
}

describe('liveLocationStateMachine', () => {
  it('start installs an active session capped at MAX_DURATION_MS', () => {
    const next = reduce(emptyState(), {
      type: 'start',
      sessionId: 's1',
      recipientPubkey: RECIPIENT,
      // 24 h — well past the 1 h cap.
      durationMs: 24 * 60 * 60 * 1000,
      now: 1_700_000_000_000,
    });
    const session = next.get('s1');
    expect(session).toBeDefined();
    expect(session?.status).toBe('active');
    expect(session?.durationMs).toBe(60 * 60 * 1000);
    expect(session?.startMarkerSent).toBe(false);
    expect(activeSessions(next)).toHaveLength(1);
  });

  it('ping bumps lastPingAt only while active', () => {
    let s = reduce(emptyState(), {
      type: 'start',
      sessionId: 's1',
      recipientPubkey: RECIPIENT,
      durationMs: 15 * 60 * 1000,
      now: 1_700_000_000_000,
    });
    s = reduce(s, { type: 'ping', sessionId: 's1', now: 1_700_000_010_000 });
    expect(s.get('s1')?.lastPingAt).toBe(1_700_000_010_000);
    s = reduce(s, { type: 'pause', sessionId: 's1' });
    s = reduce(s, { type: 'ping', sessionId: 's1', now: 1_700_000_020_000 });
    // Paused session must not accept pings — the watcher is meant
    // to be off, so a stray fix shouldn't reset our last-update UI.
    expect(s.get('s1')?.lastPingAt).toBe(1_700_000_010_000);
  });

  it('tickExpiryCheck flips active sessions whose window passed', () => {
    let s = reduce(emptyState(), {
      type: 'start',
      sessionId: 's1',
      recipientPubkey: RECIPIENT,
      durationMs: 15 * 60 * 1000,
      now: 1_700_000_000_000,
    });
    // 14 minutes in — still active.
    s = reduce(s, { type: 'tickExpiryCheck', now: 1_700_000_000_000 + 14 * 60 * 1000 });
    expect(s.get('s1')?.status).toBe('active');
    // 16 minutes in — past expiry.
    s = reduce(s, { type: 'tickExpiryCheck', now: 1_700_000_000_000 + 16 * 60 * 1000 });
    expect(s.get('s1')?.status).toBe('expired');
  });

  it('pause then resume flips back to active when within window', () => {
    let s = reduce(emptyState(), {
      type: 'start',
      sessionId: 's1',
      recipientPubkey: RECIPIENT,
      durationMs: 15 * 60 * 1000,
      now: 1_700_000_000_000,
    });
    s = reduce(s, { type: 'pause', sessionId: 's1' });
    expect(s.get('s1')?.status).toBe('paused');
    s = reduce(s, { type: 'resume', sessionId: 's1', now: 1_700_000_005_000 });
    expect(s.get('s1')?.status).toBe('active');
  });

  it('resume after expiry transitions straight to expired', () => {
    let s = reduce(emptyState(), {
      type: 'start',
      sessionId: 's1',
      recipientPubkey: RECIPIENT,
      durationMs: 15 * 60 * 1000,
      now: 1_700_000_000_000,
    });
    s = reduce(s, { type: 'pause', sessionId: 's1' });
    s = reduce(s, { type: 'resume', sessionId: 's1', now: 1_700_000_000_000 + 16 * 60 * 1000 });
    expect(s.get('s1')?.status).toBe('expired');
  });

  it('stop is terminal — re-stopping is idempotent', () => {
    let s = reduce(emptyState(), {
      type: 'start',
      sessionId: 's1',
      recipientPubkey: RECIPIENT,
      durationMs: 15 * 60 * 1000,
      now: 1_700_000_000_000,
    });
    s = reduce(s, { type: 'stop', sessionId: 's1' });
    expect(s.get('s1')?.status).toBe('ended');
    const beforeRepeat = s;
    s = reduce(s, { type: 'stop', sessionId: 's1' });
    // Reduce returns the same reference when no-op — useful so
    // React-shaped consumers can shallow-compare.
    expect(s).toBe(beforeRepeat);
  });

  it('pendingEndMarkers reflects expired sessions awaiting end-marker publish', () => {
    let s = reduce(emptyState(), {
      type: 'start',
      sessionId: 's1',
      recipientPubkey: RECIPIENT,
      durationMs: 15 * 60 * 1000,
      now: 1_700_000_000_000,
    });
    s = reduce(s, { type: 'tickExpiryCheck', now: 1_700_000_000_000 + 16 * 60 * 1000 });
    expect(pendingEndMarkers(s)).toHaveLength(1);
    s = reduce(s, { type: 'endMarkerSent', sessionId: 's1' });
    expect(pendingEndMarkers(s)).toHaveLength(0);
  });

  it('multiple concurrent sessions track independent state', () => {
    let s = reduce(emptyState(), {
      type: 'start',
      sessionId: 's1',
      recipientPubkey: RECIPIENT,
      durationMs: 15 * 60 * 1000,
      now: 1_700_000_000_000,
    });
    s = reduce(s, {
      type: 'start',
      sessionId: 's2',
      recipientPubkey: 'b'.repeat(64),
      durationMs: 60 * 60 * 1000,
      now: 1_700_000_000_000,
    });
    s = reduce(s, { type: 'stop', sessionId: 's1' });
    expect(s.get('s1')?.status).toBe('ended');
    expect(s.get('s2')?.status).toBe('active');
    expect(activeSessions(s).map((x) => x.sessionId)).toEqual(['s2']);
  });

  it('expiresAt + remainingMs use the capped duration', () => {
    const session: OutgoingSession = {
      sessionId: 's1',
      recipientPubkey: RECIPIENT,
      startedAt: 1_700_000_000_000,
      durationMs: 15 * 60 * 1000,
      lastPingAt: null,
      status: 'active',
      startMarkerSent: true,
      endMarkerSent: false,
    };
    expect(expiresAt(session)).toBe(1_700_000_000_000 + 15 * 60 * 1000);
    expect(remainingMs(session, 1_700_000_000_000 + 60_000)).toBe(14 * 60 * 1000);
    expect(remainingMs(session, 1_700_000_000_000 + 16 * 60 * 1000)).toBe(0);
  });

  it('actions targeting unknown sessionIds are no-ops', () => {
    const s = emptyState();
    expect(reduce(s, { type: 'ping', sessionId: 'missing', now: 1 })).toBe(s);
    expect(reduce(s, { type: 'pause', sessionId: 'missing' })).toBe(s);
    expect(reduce(s, { type: 'resume', sessionId: 'missing', now: 1 })).toBe(s);
    expect(reduce(s, { type: 'stop', sessionId: 'missing' })).toBe(s);
    expect(reduce(s, { type: 'endMarkerSent', sessionId: 'missing' })).toBe(s);
    expect(reduce(s, { type: 'startMarkerSent', sessionId: 'missing' })).toBe(s);
  });
});
