import {
  relayAccessTag,
  relayWriteAcceptance,
  relayDisplayName,
  relayRowHost,
} from './relayDetails';

it.each([
  [true, true, null],
  [true, false, 'readOnly'],
  [false, true, 'writeOnly'],
  [false, false, 'disabled'],
])('tags read=%s write=%s as %s', (read, write, expected) => {
  expect(relayAccessTag({ read: read as boolean, write: write as boolean })).toBe(expected);
});

it('keeps acceptance unconfirmed without a publish observation for this key', () => {
  expect(relayWriteAcceptance(null)).toBe('unknown');
  expect(relayWriteAcceptance({ limitation: {} })).toBe('notTested');
  for (const limitation of [
    { auth_required: true },
    { payment_required: true },
    { restricted_writes: true },
    { min_pow_difficulty: 8 },
  ]) {
    expect(relayWriteAcceptance({ limitation })).toBe('restricted');
  }
});

it('uses the last observed publish result over advertised restrictions', () => {
  const info = { limitation: { payment_required: true } };
  expect(relayWriteAcceptance(info, { pubkey: 'a', ok: true, at: 1 })).toBe('lastAccepted');
  expect(relayWriteAcceptance(info, { pubkey: 'a', ok: false, at: 2 })).toBe('lastRejected');
});

it('shows secure relay names without a scheme, preserving insecure schemes and URL paths', () => {
  expect(relayDisplayName('wss://relay.primal.net')).toBe('relay.primal.net');
  expect(relayDisplayName('wss://example.com:443/path')).toBe('example.com:443/path');
  expect(relayDisplayName('ws://example.com/path')).toBe('ws://example.com/path');
});

it.each([
  ['wss://relay.example.com/path', 'relay.example.com'],
  ['wss://relay.example.com:8443/path', 'relay.example.com:8443'],
  ['https://blossom.example.com/upload', 'blossom.example.com'],
  ['invalid-url', 'invalid-url'],
])('uses the host of %s in row accessibility labels', (url, host) => {
  expect(relayRowHost(url)).toBe(host);
});
