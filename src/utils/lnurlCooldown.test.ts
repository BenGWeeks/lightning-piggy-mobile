import { SLEEPING_PATTERN, parseCooldownSeconds, formatCountdown } from './lnurlCooldown';

describe('SLEEPING_PATTERN', () => {
  it.each([
    'Wait 79017 seconds.',
    'wait_time: 240',
    'You must wait 30 more seconds',
    'cooldown still running',
    'daily budget exhausted',
    'too soon, try later',
  ])('matches benign cooldown message: %s', (msg) => {
    expect(SLEEPING_PATTERN.test(msg)).toBe(true);
  });

  it.each([
    'Invalid LNURL',
    'Network request failed',
    'Not connected',
    // A consumed single-use voucher is a permanent hard error, NOT a cooldown —
    // it must be shown as-is, never routed into the counting-down sleeping UI.
    'voucher already used',
    'This withdraw link was already claimed',
  ])('does not match hard error: %s', (msg) => {
    expect(SLEEPING_PATTERN.test(msg)).toBe(false);
  });
});

describe('parseCooldownSeconds', () => {
  it('parses the LNbits "Wait N seconds" shape', () => {
    expect(parseCooldownSeconds('Wait 79017 seconds.')).toBe(79017);
  });
  it('parses "wait_time: N"', () => {
    expect(parseCooldownSeconds('wait_time: 240')).toBe(240);
  });
  it('handles counts beyond 5 digits (long cooldowns)', () => {
    expect(parseCooldownSeconds('Wait 100000 seconds')).toBe(100000);
  });
  it('returns null when there is no time hint', () => {
    expect(parseCooldownSeconds('budget exhausted')).toBeNull();
    expect(parseCooldownSeconds('already used')).toBeNull();
  });
  it('returns null for a zero/invalid count', () => {
    expect(parseCooldownSeconds('Wait 0 seconds')).toBeNull();
  });
});

describe('formatCountdown', () => {
  it('shows bare seconds under a minute', () => {
    expect(formatCountdown(45)).toBe('45s');
    expect(formatCountdown(0)).toBe('0s');
  });
  it('shows M:SS under an hour', () => {
    expect(formatCountdown(185)).toBe('3:05');
    expect(formatCountdown(60)).toBe('1:00');
  });
  it('shows Hh MMm under a day', () => {
    expect(formatCountdown(3 * 3600 + 5 * 60)).toBe('3h 05m');
    expect(formatCountdown(3600)).toBe('1h 00m');
  });
  it('shows Dd HHh for a day or more', () => {
    expect(formatCountdown(86400 + 3 * 3600)).toBe('1d 03h');
    expect(formatCountdown(79017)).toBe('21h 56m');
  });
  it('never goes negative', () => {
    expect(formatCountdown(-5)).toBe('0s');
  });
});
