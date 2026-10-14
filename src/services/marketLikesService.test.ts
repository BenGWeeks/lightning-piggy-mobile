import type { Event } from 'nostr-tools';
import { fetchLikedListings, fetchListingLikes } from './marketLikesService';
import { querySyncAbortable } from './relayQuery';
import { resolveEmbed } from './nostrEmbedCache';
import type { MarketProduct } from '../data/marketProducts';

// No real relays: the query helper and the embed resolver are mocked.
jest.mock('./nostrPool', () => ({ pool: {}, trackRelays: jest.fn() }));
jest.mock('./relayQuery', () => ({ querySyncAbortable: jest.fn() }));
jest.mock('./nostrEmbedCache', () => ({ resolveEmbed: jest.fn() }));

const query = querySyncAbortable as jest.Mock;
const resolve = resolveEmbed as jest.Mock;
const SELLER = 'a'.repeat(64);
const ME = 'c'.repeat(64);
const ALICE = 'd'.repeat(64);
const COORD = `30402:${SELLER}:widget`;
const GONE = `30402:${SELLER}:sold`;

const like = (id: string, pubkey: string, coordinate = COORD, created_at = 100): Event => ({
  id,
  pubkey,
  kind: 7,
  content: '+',
  created_at,
  tags: [
    ['a', coordinate],
    ['k', '30402'],
  ],
  sig: 'x',
});
const retraction = (pubkey: string, id: string): Event => ({
  id: `del-${id}`,
  pubkey,
  kind: 5,
  content: '',
  created_at: 200,
  tags: [['e', id]],
  sig: 'x',
});

beforeEach(() => jest.clearAllMocks());

describe('fetchListingLikes', () => {
  it('queries kind 7 by #a with a limit, then retractions, and aggregates', async () => {
    query.mockImplementation((_pool, _relays, filter) =>
      Promise.resolve(
        filter.kinds[0] === 7
          ? [like('r1', ALICE), like('r2', ME), like('r3', ME)]
          : [retraction(ME, 'r3')],
      ),
    );
    const likes = await fetchListingLikes(
      COORD,
      ME,
      ['wss://mine.example'],
      new AbortController().signal,
    );
    const [, relays, reactionFilter] = query.mock.calls[0];
    expect(reactionFilter).toEqual({ kinds: [7], '#a': [COORD], limit: 500 });
    expect(relays).toContain('wss://mine.example');
    expect(query.mock.calls[1][2]).toEqual({
      kinds: [7],
      authors: [ME],
      '#a': [COORD],
      limit: 50,
    });
    expect(query.mock.calls[2][2]).toMatchObject({ kinds: [5], '#e': ['r1', 'r2', 'r3'] });
    expect(likes).toEqual({ count: 2, myReactionId: 'r2', myReactionIds: ['r2'] });
  });

  it("finds the viewer's like even when the public query's limit crowds it out", async () => {
    query.mockImplementation((_pool, _relays, filter) =>
      Promise.resolve(
        filter.kinds[0] !== 7
          ? []
          : filter.authors
            ? [like('mine', ME)]
            : [like('a1', ALICE), like('a2', 'e'.repeat(64))],
      ),
    );
    const likes = await fetchListingLikes(COORD, ME, [], new AbortController().signal);
    expect(likes.myReactionIds).toEqual(['mine']);
    expect(likes.count).toBe(3);
  });

  it('skips the own-reactions query when signed out', async () => {
    query.mockResolvedValue([like('a1', ALICE)]);
    await fetchListingLikes(COORD, null, [], new AbortController().signal);
    expect(query.mock.calls.filter(([, , f]) => f.kinds[0] === 7)).toHaveLength(1);
  });
});

describe('fetchLikedListings', () => {
  it("resolves the viewer's active likes to live products, dropping gone listings", async () => {
    query.mockImplementation((_pool, _relays, filter) =>
      Promise.resolve(
        filter.kinds[0] === 7
          ? [like('r1', ME, COORD, 100), like('r2', ME, GONE, 300), like('r3', ME, COORD, 50)]
          : [retraction(ME, 'r3')],
      ),
    );
    const product = { id: 'widget' } as MarketProduct;
    resolve.mockImplementation((ref) =>
      Promise.resolve(
        ref.identifier === 'widget' ? { event: null, product } : { event: null, product: null },
      ),
    );
    const products = await fetchLikedListings(ME, [], new AbortController().signal);
    expect(query.mock.calls[0][2]).toEqual({
      kinds: [7],
      authors: [ME],
      '#k': ['30402'],
      limit: 500,
    });
    expect(query.mock.calls[1][2]).toMatchObject({ kinds: [5], authors: [ME] });
    expect(resolve.mock.calls.map(([ref]) => ref.identifier)).toEqual(['sold', 'widget']);
    expect(products).toEqual([product]);
  });

  it('returns nothing once aborted', async () => {
    const controller = new AbortController();
    query.mockImplementation(() => {
      controller.abort();
      return Promise.resolve([like('r1', ME)]);
    });
    await expect(fetchLikedListings(ME, [], controller.signal)).resolves.toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
  });
});
