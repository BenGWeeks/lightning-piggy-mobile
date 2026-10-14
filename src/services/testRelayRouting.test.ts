import { normalizeURL } from 'nostr-tools/utils';
import { SimplePool } from 'nostr-tools/pool';
import type { Event } from 'nostr-tools';
import { pool } from './nostrPool';
import { setCurrentUserPubkey } from './nostrActiveAccount';
import { TEST_ACCOUNT_PUBKEYS, TEST_RELAY_URL } from '../config/testRelayLockdown';
import { buildDmInboxEvent, buildRelayListEvent } from '../utils/relayListEvents';

jest.mock('./relayHealth', () => ({
  RELAY_CONNECT_TIMEOUT_MS: 10,
  hydrateRelayHealth: jest.fn(),
  selectHealthyRelays: (urls: string[]) => urls,
  recordRelayPublish: jest.fn(),
  noteNetworkActivity: jest.fn(),
}));
afterEach(() => {
  setCurrentUserPubkey(null);
  jest.restoreAllMocks();
});
it.each([true, false])('filters publish and query at call time (locked: %s)', async (locked) => {
  const urls = ['wss://one.example', 'wss://two.example'];
  const publish = jest
    .spyOn(SimplePool.prototype, 'publish')
    .mockImplementation((targets) => targets.map(() => Promise.resolve('saved')));
  const requests: string[] = [];
  const ensure = jest.spyOn(pool, 'ensureRelay').mockImplementation(async (url) => {
    requests.push(url);
    throw new Error('offline');
  });
  setCurrentUserPubkey(locked ? [...TEST_ACCOUNT_PUBKEYS][0] : 'a'.repeat(64));
  await Promise.all(pool.publish(urls, { pubkey: 'ephemeral' } as Event));
  expect(publish.mock.calls[0][0]).toEqual(locked ? [TEST_RELAY_URL] : urls);
  await pool.querySync(urls, { kinds: [0], limit: 1 }, { maxWait: 10 });
  expect([...new Set(requests)]).toEqual((locked ? [TEST_RELAY_URL] : urls).map(normalizeURL));
  ensure.mockRestore();
});
it('takes effect immediately on account switch and closes prior transports', () => {
  const destroy = jest.spyOn(pool, 'destroy');
  setCurrentUserPubkey([...TEST_ACCOUNT_PUBKEYS][0]);
  expect(destroy).toHaveBeenCalled();
  expect(
    buildRelayListEvent([{ url: 'wss://public.example', read: true, write: true }]).tags,
  ).toEqual([['r', TEST_RELAY_URL]]);
  expect(buildDmInboxEvent(['wss://public.example']).tags).toEqual([['relay', TEST_RELAY_URL]]);
});
