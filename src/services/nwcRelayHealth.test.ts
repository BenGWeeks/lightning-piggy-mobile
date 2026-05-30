/**
 * Unit tests for the NWC relay-health module (#785 / #786).
 *
 * Covers two independent back-off mechanisms plus the tri-state wallet health:
 *  - the reply-timeout cooldown (#656) — moved here from nwcService.test.ts now
 *    that `isRelayInCooldown` / `recordRelayOutcome` live in this module;
 *  - the rate-limit publish back-off (#785), whose KEY regression is that a
 *    successful READ must NOT clear it (rate-limiting is about publish volume,
 *    not backend health);
 *  - `getWalletHealth` returning responsive / degraded / disconnected.
 *
 * These functions hold module-level Maps keyed by walletId, so every test uses
 * a UNIQUE walletId to stay isolated (no shared mutable state across cases).
 */

import {
  RELAY_COOLDOWN_BASE_MS,
  RELAY_COOLDOWN_MAX_MS,
  RELAY_DEAD_AFTER_FAILURES,
  getWalletHealth,
  isRateLimitError,
  isRelayDead,
  isRelayInCooldown,
  markRelayResponsive,
  recordRateLimited,
  recordRelayOutcome,
} from './nwcRelayHealth';

// A connection error that recordRelayOutcome counts toward "dead". The message
// matches isConnectionError's matcher in nwcErrors.
const connErr = () => new Error('Failed to connect to wss://relay.example.com');

let nextId = 0;
const freshId = () => `wallet-${nextId++}`;

afterEach(() => {
  jest.useRealTimers();
});

describe('isRateLimitError', () => {
  it.each([
    'rate-limited',
    'rate limited: slow down',
    'too many requests',
    'too fast, please wait',
    'slow down',
    'temp-ban for 60s',
    'tempban',
    'request throttled',
    'blocked by relay',
  ])('matches %p', (msg) => {
    expect(isRateLimitError(new Error(msg))).toBe(true);
  });

  it('does NOT match a plain reply timeout', () => {
    expect(isRateLimitError(new Error('reply timeout'))).toBe(false);
  });

  it('does NOT match a generic connection error', () => {
    expect(isRateLimitError(connErr())).toBe(false);
  });

  it('tolerates non-Error values', () => {
    expect(isRateLimitError(undefined)).toBe(false);
    expect(isRateLimitError('rate-limited')).toBe(true);
  });
});

describe('reply-timeout cooldown (#656)', () => {
  it('is false for a fresh / responsive wallet', () => {
    const id = freshId();
    expect(isRelayInCooldown(id)).toBe(false);
    expect(isRelayDead(id)).toBe(false);
  });

  it('stays out of cooldown until the relay crosses the dead threshold', () => {
    const id = freshId();
    for (let i = 0; i < RELAY_DEAD_AFTER_FAILURES - 1; i++) recordRelayOutcome(id, connErr());
    expect(isRelayInCooldown(id)).toBe(false);
    expect(isRelayDead(id)).toBe(false);
  });

  it('enters cooldown once the relay is considered dead', () => {
    const id = freshId();
    for (let i = 0; i < RELAY_DEAD_AFTER_FAILURES; i++) recordRelayOutcome(id, connErr());
    expect(isRelayInCooldown(id)).toBe(true);
    expect(isRelayDead(id)).toBe(true);
  });

  it('clears the cooldown the moment the relay answers again (markRelayResponsive)', () => {
    const id = freshId();
    for (let i = 0; i < RELAY_DEAD_AFTER_FAILURES; i++) recordRelayOutcome(id, connErr());
    expect(isRelayInCooldown(id)).toBe(true);
    // An answered request (no error) resets the failure counter + cooldown.
    recordRelayOutcome(id);
    expect(isRelayInCooldown(id)).toBe(false);
    expect(isRelayDead(id)).toBe(false);
  });

  it('expires on its own timer', () => {
    jest.useFakeTimers();
    const id = freshId();
    const t0 = Date.now();
    jest.setSystemTime(t0);
    for (let i = 0; i < RELAY_DEAD_AFTER_FAILURES; i++) recordRelayOutcome(id, connErr());
    expect(isRelayInCooldown(id)).toBe(true);
    jest.setSystemTime(t0 + RELAY_COOLDOWN_BASE_MS + 1);
    expect(isRelayInCooldown(id)).toBe(false);
  });
});

describe('rate-limit publish back-off (#785)', () => {
  it('parks the relay as soon as it rate-limits us', () => {
    const id = freshId();
    expect(isRelayInCooldown(id)).toBe(false);
    recordRateLimited(id);
    expect(isRelayInCooldown(id)).toBe(true);
  });

  it('KEY REGRESSION: a successful READ does NOT clear the rate-limit back-off', () => {
    const id = freshId();
    recordRateLimited(id);
    expect(isRelayInCooldown(id)).toBe(true);
    // A lucky answered read resets reply-timeout health …
    markRelayResponsive(id);
    recordRelayOutcome(id); // another answered request
    // … but the rate-limit back-off must remain — it's about publish volume,
    // not whether one read happened to come back.
    expect(isRelayInCooldown(id)).toBe(true);
  });

  it('escalates the back-off with each strike (doubling)', () => {
    jest.useFakeTimers();
    const id = freshId();
    const t0 = 1_000_000;
    jest.setSystemTime(t0);

    // Strike 1 → BASE window.
    recordRateLimited(id);
    jest.setSystemTime(t0 + RELAY_COOLDOWN_BASE_MS - 1);
    expect(isRelayInCooldown(id)).toBe(true);

    // Strike 2 lands WHILE still parked (a repeat publish into the ban, the
    // real-world case) — so strikes climb to 2 and the window becomes 2×BASE
    // from this moment. We don't read isRelayInCooldown first, which would
    // reset the strike count once a window has lapsed.
    const t1 = t0 + RELAY_COOLDOWN_BASE_MS - 1;
    recordRateLimited(id);
    jest.setSystemTime(t1 + RELAY_COOLDOWN_BASE_MS + 1);
    expect(isRelayInCooldown(id)).toBe(true); // still parked: window is 2×BASE
    jest.setSystemTime(t1 + 2 * RELAY_COOLDOWN_BASE_MS + 1);
    expect(isRelayInCooldown(id)).toBe(false);
  });

  it('caps the escalating back-off at RELAY_COOLDOWN_MAX_MS', () => {
    jest.useFakeTimers();
    const id = freshId();
    let t = 0;
    // Hammer many strikes so 2^(strikes-1) blows past the cap.
    for (let i = 0; i < 12; i++) {
      jest.setSystemTime(t);
      recordRateLimited(id);
      // Advance past the max window so the next strike records cleanly.
      t += RELAY_COOLDOWN_MAX_MS + 1;
    }
    // Last strike's window must be exactly the cap, not unbounded.
    const last = t - (RELAY_COOLDOWN_MAX_MS + 1);
    jest.setSystemTime(last + RELAY_COOLDOWN_MAX_MS - 1);
    expect(isRelayInCooldown(id)).toBe(true);
    jest.setSystemTime(last + RELAY_COOLDOWN_MAX_MS + 1);
    expect(isRelayInCooldown(id)).toBe(false);
  });

  it('resets strikes once the back-off expires so a recovered relay starts fresh', () => {
    jest.useFakeTimers();
    const id = freshId();
    const t0 = 5_000_000;
    jest.setSystemTime(t0);
    recordRateLimited(id);
    recordRateLimited(id); // 2 strikes → window 2×BASE
    // Let it lapse (this also resets the strike count inside isRelayInCooldown).
    jest.setSystemTime(t0 + 2 * RELAY_COOLDOWN_BASE_MS + 1);
    expect(isRelayInCooldown(id)).toBe(false);
    // A NEW rate-limit should restart at strike 1 → BASE window, not 4×BASE.
    const t1 = t0 + 2 * RELAY_COOLDOWN_BASE_MS + 2;
    jest.setSystemTime(t1);
    recordRateLimited(id);
    jest.setSystemTime(t1 + RELAY_COOLDOWN_BASE_MS - 1);
    expect(isRelayInCooldown(id)).toBe(true);
    jest.setSystemTime(t1 + RELAY_COOLDOWN_BASE_MS + 1);
    expect(isRelayInCooldown(id)).toBe(false);
  });
});

describe('getWalletHealth (#786)', () => {
  it('is disconnected when the WebSocket is not connected — regardless of relay state', () => {
    const id = freshId();
    expect(getWalletHealth(id, false)).toBe('disconnected');
    // Even parked, a down socket reads disconnected (red beats amber).
    recordRateLimited(id);
    expect(getWalletHealth(id, false)).toBe('disconnected');
  });

  it('is responsive when connected and the relay is answering', () => {
    const id = freshId();
    expect(getWalletHealth(id, true)).toBe('responsive');
  });

  it('is degraded when connected but the relay is rate-limit parked', () => {
    const id = freshId();
    recordRateLimited(id);
    expect(getWalletHealth(id, true)).toBe('degraded');
  });

  it('is degraded on a single recent reply-timeout (before crossing the dead threshold)', () => {
    const id = freshId();
    recordRelayOutcome(id, connErr()); // 1 failure, not yet "dead"
    expect(isRelayInCooldown(id)).toBe(false);
    expect(getWalletHealth(id, true)).toBe('degraded');
  });

  it('clears back to responsive as soon as a request answers (live read)', () => {
    const id = freshId();
    recordRelayOutcome(id, connErr());
    expect(getWalletHealth(id, true)).toBe('degraded');
    recordRelayOutcome(id); // answered
    expect(getWalletHealth(id, true)).toBe('responsive');
  });
});
