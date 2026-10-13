import { withRelayHealth } from './healthAwarePool';
import { recordRelayPublish } from './relayHealth';

jest.mock('./relayHealth', () => ({
  RELAY_CONNECT_TIMEOUT_MS: 5000,
  RELAY_SKIPPED_REASON: 'relay skipped (unhealthy)',
  noteNetworkActivity: jest.fn(),
  recordRelayFailure: jest.fn(),
  recordRelaySuccess: jest.fn(),
  recordRelayConnectionObservation: jest.fn(),
  recordRelayPublish: jest.fn(),
  selectHealthyRelays: (relays: string[]) => relays,
}));

// Stand-in for nostr-tools' pool: publish resolves per relay with whatever
// the test queues, exactly like SimplePool resolving "connection failure: …".
const queued: string[] = [];
class FakePool {
  publish(relays: string[]): Promise<string>[] {
    return relays.map((_, i) => Promise.resolve(queued[i] ?? ''));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mixin over a minimal fake base
const HealthAware = withRelayHealth(FakePool as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the mixin returns an abstract class
const pool = new (HealthAware as any)();

const event = { id: 'e', pubkey: 'p', sig: 's', kind: 1, created_at: 1, tags: [], content: '' };

describe('withRelayHealth publish', () => {
  beforeEach(() => {
    queued.length = 0;
  });

  it('rejects a relay that nostr-tools resolved as a connection failure', async () => {
    queued.push('connection failure: timeout', '');
    const [failed, ok] = pool.publish(['wss://a.example', 'wss://b.example'], event);
    await expect(failed).rejects.toThrow('connection failure: timeout');
    await expect(ok).resolves.toBe('');
    expect(recordRelayPublish).toHaveBeenCalledWith(
      'wss://a.example',
      'p',
      false,
      expect.any(Error),
    );
    expect(recordRelayPublish).toHaveBeenCalledWith('wss://b.example', 'p', true);
  });

  it('makes Promise.any fail when every relay was unreachable', async () => {
    queued.push('connection failure: a', 'connection failure: b');
    await expect(
      Promise.any(pool.publish(['wss://a.example', 'wss://b.example'], event)),
    ).rejects.toBeInstanceOf(AggregateError);
  });
});
