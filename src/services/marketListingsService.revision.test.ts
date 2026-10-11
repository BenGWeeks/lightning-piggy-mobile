import type { Event, Filter } from 'nostr-tools';
import { fetchListingRevision } from './marketListingsService';
import { querySyncAbortable } from './relayQuery';

jest.mock('./nostrPool', () => ({ pool: {}, trackRelays: jest.fn() }));
jest.mock('./relayQuery', () => ({ querySyncAbortable: jest.fn() }));

const query = querySyncAbortable as jest.Mock;
const RELAYS = ['wss://relay.example'];
const SELLER = 'a'.repeat(64);

const listing = (id: string, createdAt: number, title: string, d = 'book'): Event => ({
  id: id.repeat(64),
  pubkey: SELLER,
  kind: 30402,
  created_at: createdAt,
  content: 'A book',
  tags: [
    ['d', d],
    ['title', title],
    ['price', '21', 'SAT'],
  ],
  sig: '',
});
const current = listing('1', 100, 'Old title');

/** Answer the revision query with `revisions`, kind-5 lookups with `deletions`. */
const relaysReturn = (revisions: Event[], deletions: Event[] = []) =>
  query.mockImplementation((_pool, _relays, filter: Filter) =>
    Promise.resolve(filter.kinds?.includes(5) ? deletions : revisions),
  );
const signal = () => new AbortController().signal;

beforeEach(() => query.mockReset());

describe('fetchListingRevision', () => {
  it('returns the newest revision of the same address', async () => {
    relaysReturn([listing('2', 200, 'New title')]);
    const product = await fetchListingRevision(current, RELAYS, signal());
    expect(product?.title).toBe('New title');
    expect(query.mock.calls[0][2]).toEqual({
      kinds: [30402],
      authors: [SELLER],
      '#d': ['book'],
      limit: 10,
    });
  });

  it('keeps the current revision when nothing newer exists', async () => {
    relaysReturn([]);
    expect((await fetchListingRevision(current, RELAYS, signal()))?.listing?.event.id).toBe(
      current.id,
    );
  });

  it('ignores another listing a relay sends back for the `#d` request', async () => {
    relaysReturn([listing('3', 300, 'Other', 'pen')]);
    expect((await fetchListingRevision(current, RELAYS, signal()))?.title).toBe('Old title');
  });

  it('returns null when the seller deleted the listing', async () => {
    const del: Event = {
      ...current,
      id: '4'.repeat(64),
      kind: 5,
      created_at: 150,
      tags: [['a', `30402:${SELLER}:book`]],
      content: '',
    };
    relaysReturn([], [del]);
    expect(await fetchListingRevision(current, RELAYS, signal())).toBeNull();
  });

  it('rejects when every relay failed the revision query', async () => {
    query.mockImplementation((_p, _r, filter: Filter) =>
      filter.kinds?.includes(5) ? Promise.resolve([]) : Promise.reject(new Error('down')),
    );
    await expect(fetchListingRevision(current, RELAYS, signal())).rejects.toThrow('down');
  });
});
