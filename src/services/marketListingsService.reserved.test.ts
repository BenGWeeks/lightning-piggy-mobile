import { finalizeEvent, getPublicKey, type Event } from 'nostr-tools';
import { fetchMarketListings } from './marketListingsService';
import { collectRelaySnapshot } from './relaySnapshot';
import { ROBOTECHY_PUBKEY, samplePreferredProducts } from '../utils/marketSample';

jest.mock('./nostrCrypto', () => {
  const pure = jest.requireActual('nostr-tools/pure');
  return { nostrGetEventHash: pure.getEventHash, nostrVerifyEvent: pure.verifyEvent };
});
jest.mock('./nostrPool', () => ({ pool: {}, trackRelays: jest.fn() }));
jest.mock('./marketListingsPool', () => ({
  acquireMarketListingsPool: () => ({ pool: {}, release: jest.fn() }),
}));
jest.mock('./relaySnapshot', () => ({ collectRelaySnapshot: jest.fn() }));
jest.mock('../utils/marketSample', () => ({
  ...jest.requireActual('../utils/marketSample'),
  ROBOTECHY_PUBKEY: jest.requireActual('nostr-tools').getPublicKey(new Uint8Array(32).fill(9)),
}));
const sellerKey = new Uint8Array(32).fill(7);
const robotechyKey = new Uint8Array(32).fill(9);
const listing = (key: Uint8Array, d: string, created_at: number, status = 'active') =>
  finalizeEvent(
    {
      kind: 30402,
      created_at,
      content: d,
      tags: [
        ['d', d],
        ['title', d],
        ['price', '1', 'SAT'],
        ['status', status],
      ],
    },
    key,
  );
const recent = Array.from({ length: 251 }, (_, i) => listing(sellerKey, `item-${i}`, 1000 + i));
const robot = listing(robotechyKey, 'robot', 100);

it.each(['valid', 'forged-newer', 'sold', 'deleted'])(
  'reserves an older verified Robotechy listing with revision/deletion checks: %s',
  async (state) => {
    const candidates: Event[] = [...recent, robot];
    const deletions: Event[] = [];
    if (state === 'forged-newer')
      candidates.push(
        JSON.parse(
          JSON.stringify({
            ...listing(robotechyKey, 'robot', 200),
            sig: '0'.repeat(128),
          }),
        ),
      );
    if (state === 'sold') candidates.push(listing(robotechyKey, 'robot', 200, 'sold'));
    if (state === 'deleted')
      deletions.push(
        finalizeEvent(
          { kind: 5, created_at: 200, content: '', tags: [['e', robot.id]] },
          robotechyKey,
        ),
      );
    (collectRelaySnapshot as jest.Mock).mockImplementation(async (opts) => {
      (opts.filters[0].kinds[0] === 5 ? deletions : candidates).forEach(opts.onEvent);
      return { answered: opts.urls, responded: opts.urls, truncated: false, truncatedSince: null };
    });
    const result = await fetchMarketListings(
      [getPublicKey(sellerKey), ROBOTECHY_PUBKEY],
      ['wss://example.com'],
      new AbortController().signal,
    );
    expect(result.products).toHaveLength(250);
    expect(result.incomplete).toBe(false);
    const reserved = result.products.find((p) => p.listing?.event.pubkey === ROBOTECHY_PUBKEY);
    if (state === 'valid' || state === 'forged-newer') {
      expect(reserved?.listing?.event.id).toBe(robot.id);
      // The sampler's real constant is the production key; use its reservation
      // with the verified fixture mapped to that public identity.
      const productionKey = jest.requireActual('../utils/marketSample').ROBOTECHY_PUBKEY;
      const products = result.products.map((p) =>
        p === reserved
          ? {
              ...p,
              listing: { ...p.listing!, event: { ...p.listing!.event, pubkey: productionKey } },
            }
          : p,
      );
      expect(samplePreferredProducts(products).some((p) => p.id === reserved?.id)).toBe(true);
    } else expect(reserved).toBeUndefined();
  },
);
