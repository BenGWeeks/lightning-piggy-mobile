import { AbstractRelay } from 'nostr-tools/abstract-relay';
import type { VerifiedEvent } from 'nostr-tools';
import { normalizeURL } from 'nostr-tools/utils';
import { pool } from '../services/nostrPool';
import { setCurrentUserPubkey } from '../services/nostrActiveAccount';
import { TEST_RELAY_URL } from '../config/testRelayLockdown';
import { TEST_ACCOUNT_KEYS } from './testAccounts';
import { runNativeEngineBench } from './nativeEngineBench';

jest.mock('../services/relayHealth', () => ({
  hydrateRelayHealth: jest.fn(),
  selectHealthyRelays: (urls: string[]) => urls,
  noteNetworkActivity: jest.fn(),
  recordRelayPublish: jest.fn(),
}));
jest.mock('./nip17Unwrap', () => ({ unwrapWrapNsec: jest.fn() }));
jest.mock('../contexts/nostrDecryptPacing', () => ({ yieldToEventLoop: jest.fn() }));
jest.mock('../../modules/nostr-native', () => ({ getNostrEngine: jest.fn() }));

it('releases the benchmark subscription without closing application subscriptions on the LAN relay', async () => {
  jest.useFakeTimers();
  setCurrentUserPubkey(TEST_ACCOUNT_KEYS.big);
  const url = normalizeURL(TEST_RELAY_URL);
  const relay = new AbstractRelay(url, { verifyEvent: (event): event is VerifiedEvent => !!event });
  jest.spyOn(relay, 'send').mockResolvedValue();
  const relays = (pool as unknown as { relays: Map<string, AbstractRelay> }).relays;
  relays.set(url, relay);
  const appSub = relay.prepareSubscription([{ kinds: [1], limit: 1 }], {});
  const benchSub = relay.prepareSubscription([{ kinds: [1059], limit: 200 }], {});
  const close = jest.fn(async () => benchSub.close());
  const subscribe = jest.spyOn(pool, 'subscribeMany').mockReturnValue({ close });
  try {
    const outcome = runNativeEngineBench();
    const rejection = expect(outcome).rejects.toThrow('js phase timed out');
    await jest.advanceTimersByTimeAsync(180_000);
    await rejection;
    expect(subscribe.mock.calls[0][0]).toEqual([TEST_RELAY_URL]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(relays.get(url)).toBe(relay);
    expect(relay.openSubs.has(appSub.id)).toBe(true);
    expect(relay.openSubs.has(benchSub.id)).toBe(false);
  } finally {
    subscribe.mockRestore();
    relay.close();
    relays.delete(url);
    setCurrentUserPubkey(null);
    jest.restoreAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});
