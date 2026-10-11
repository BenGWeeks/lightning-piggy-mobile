import { finalizeEvent, getPublicKey, type Event, type Filter } from 'nostr-tools';
import { fetchListingRevision } from './marketListingsService';
import { querySyncAbortable } from './relayQuery';

jest.mock('./nostrPool', () => ({ pool: {}, trackRelays: jest.fn() }));
jest.mock('./relayQuery', () => ({ querySyncAbortable: jest.fn() }));

const query = querySyncAbortable as jest.Mock;
const RELAYS = ['wss://relay.example'];
const SELLER_KEY = new Uint8Array(32).fill(7);
const SELLER = getPublicKey(SELLER_KEY);
const STRANGER_KEY = new Uint8Array(32).fill(9);

/** A really signed listing revision (the service checks signatures). */
const listing = (createdAt: number, title: string, d = 'book', key = SELLER_KEY): Event =>
  finalizeEvent(
    {
      kind: 30402,
      created_at: createdAt,
      content: 'A book',
      tags: [
        ['d', d],
        ['title', title],
        ['price', '21', 'SAT'],
      ],
    },
    key,
  );
const current = listing(100, 'Old title');

/** Answer the revision query with `revisions`, kind-5 lookups with `deletions`. */
const relaysReturn = (revisions: Event[], deletions: Event[] = []) =>
  query.mockImplementation((_pool, _relays, filter: Filter) =>
    Promise.resolve(filter.kinds?.includes(5) ? deletions : revisions),
  );
const signal = () => new AbortController().signal;
/** A tampered copy — rebuilt from JSON so it doesn't inherit nostr-tools'
 * memoised "verified" marker (a Symbol, which object spread copies). */
const tampered = (event: Event, over: Partial<Event>): Event =>
  ({ ...JSON.parse(JSON.stringify(event)), ...over }) as Event;

beforeEach(() => query.mockReset());

describe('fetchListingRevision', () => {
  it('returns the newest revision of the same address', async () => {
    relaysReturn([listing(200, 'New title')]);
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
    relaysReturn([listing(300, 'Other', 'pen')]);
    expect((await fetchListingRevision(current, RELAYS, signal()))?.title).toBe('Old title');
  });

  it('ignores a newer revision with a forged signature', async () => {
    const forged = tampered(listing(200, 'Forged'), { sig: 'f'.repeat(128) });
    relaysReturn([forged]);
    expect((await fetchListingRevision(current, RELAYS, signal()))?.title).toBe('Old title');
  });

  it("ignores another author's revision of the same address", async () => {
    relaysReturn([listing(200, 'Hijack', 'book', STRANGER_KEY)]);
    expect((await fetchListingRevision(current, RELAYS, signal()))?.title).toBe('Old title');
  });

  it('returns null when the seller deleted the listing', async () => {
    const del = finalizeEvent(
      { kind: 5, created_at: 150, content: '', tags: [['a', `30402:${SELLER}:book`]] },
      SELLER_KEY,
    );
    relaysReturn([], [del]);
    expect(await fetchListingRevision(current, RELAYS, signal())).toBeNull();
  });

  it('ignores a forged deletion', async () => {
    const del = finalizeEvent(
      { kind: 5, created_at: 150, content: '', tags: [['a', `30402:${SELLER}:book`]] },
      SELLER_KEY,
    );
    relaysReturn([], [tampered(del, { sig: '0'.repeat(128) })]);
    expect((await fetchListingRevision(current, RELAYS, signal()))?.title).toBe('Old title');
  });

  it('returns null when the newest revision is sold', async () => {
    const sold = finalizeEvent(
      {
        kind: 30402,
        created_at: 200,
        content: 'A book',
        tags: [
          ['d', 'book'],
          ['title', 'Old title'],
          ['price', '21', 'SAT'],
          ['status', 'sold'],
        ],
      },
      SELLER_KEY,
    );
    relaysReturn([sold]);
    expect(await fetchListingRevision(current, RELAYS, signal())).toBeNull();
  });

  it('rejects when every relay failed the revision query', async () => {
    query.mockImplementation((_p, _r, filter: Filter) =>
      filter.kinds?.includes(5) ? Promise.resolve([]) : Promise.reject(new Error('down')),
    );
    await expect(fetchListingRevision(current, RELAYS, signal())).rejects.toThrow('down');
  });
});
