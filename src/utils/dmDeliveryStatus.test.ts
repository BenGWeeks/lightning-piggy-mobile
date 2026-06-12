import {
  aggregateRelayResults,
  summariseDelivery,
  shortRelayLabel,
  type RelaySettle,
} from './dmDeliveryStatus';

describe('aggregateRelayResults', () => {
  it('marks all relays ok when every wrap landed everywhere', () => {
    const settles: RelaySettle[] = [
      { relay: 'wss://a', ok: true },
      { relay: 'wss://b', ok: true },
      // self-copy wrap to the same relays
      { relay: 'wss://a', ok: true },
      { relay: 'wss://b', ok: true },
    ];
    const status = aggregateRelayResults(settles);
    expect(status.delivered).toBe(true);
    expect(status.relayResults).toEqual({ 'wss://a': 'ok', 'wss://b': 'ok' });
  });

  it('marks a relay ok if it accepted at least one wrap (partial across wraps)', () => {
    const settles: RelaySettle[] = [
      // recipient wrap landed on a, failed on b
      { relay: 'wss://a', ok: true },
      { relay: 'wss://b', ok: false },
      // self-copy failed on a, landed on b
      { relay: 'wss://a', ok: false },
      { relay: 'wss://b', ok: true },
    ];
    const status = aggregateRelayResults(settles);
    expect(status.delivered).toBe(true);
    expect(status.relayResults).toEqual({ 'wss://a': 'ok', 'wss://b': 'ok' });
  });

  it('reports a partial delivery when some relays never accepted', () => {
    const settles: RelaySettle[] = [
      { relay: 'wss://good', ok: true },
      { relay: 'wss://bad', ok: false },
      { relay: 'wss://good', ok: true },
      { relay: 'wss://bad', ok: false },
    ];
    const status = aggregateRelayResults(settles);
    expect(status.delivered).toBe(true);
    expect(status.relayResults).toEqual({ 'wss://good': 'ok', 'wss://bad': 'failed' });
    expect(summariseDelivery(status)).toEqual({ ok: 1, total: 2 });
  });

  it('reports not delivered when every relay rejected every wrap', () => {
    const settles: RelaySettle[] = [
      { relay: 'wss://a', ok: false },
      { relay: 'wss://b', ok: false },
      { relay: 'wss://a', ok: false },
      { relay: 'wss://b', ok: false },
    ];
    const status = aggregateRelayResults(settles);
    expect(status.delivered).toBe(false);
    expect(status.relayResults).toEqual({ 'wss://a': 'failed', 'wss://b': 'failed' });
    expect(summariseDelivery(status)).toEqual({ ok: 0, total: 2 });
  });

  it('handles an empty settle list as undelivered with no relays', () => {
    const status = aggregateRelayResults([]);
    expect(status.delivered).toBe(false);
    expect(status.relayResults).toEqual({});
    expect(summariseDelivery(status)).toEqual({ ok: 0, total: 0 });
  });

  it('does not let a later failure downgrade a proven ok regardless of order', () => {
    const settles: RelaySettle[] = [
      { relay: 'wss://a', ok: true },
      { relay: 'wss://a', ok: false },
    ];
    expect(aggregateRelayResults(settles).relayResults).toEqual({ 'wss://a': 'ok' });
  });
});

describe('summariseDelivery', () => {
  it('counts ok relays out of the total tracked', () => {
    const status = aggregateRelayResults([
      { relay: 'wss://a', ok: true },
      { relay: 'wss://b', ok: true },
      { relay: 'wss://c', ok: false },
    ]);
    expect(summariseDelivery(status)).toEqual({ ok: 2, total: 3 });
  });
});

describe('shortRelayLabel', () => {
  it('strips the scheme and trailing slash', () => {
    expect(shortRelayLabel('wss://relay.damus.io/')).toBe('relay.damus.io');
    expect(shortRelayLabel('ws://localhost:7777')).toBe('localhost:7777');
    expect(shortRelayLabel('relay.example.com')).toBe('relay.example.com');
  });
});
