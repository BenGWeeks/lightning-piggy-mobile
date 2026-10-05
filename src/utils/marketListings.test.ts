import { finalizeEvent, getPublicKey, nip19, type Event } from 'nostr-tools';
import { parseMarketListing, reduceMarketListings, safeMarketUrl } from './marketListings';
import { marketFeedbackContext } from './marketFeedback';
import { marketCheckoutTarget } from './marketCheckout';
import { sellerOf } from '../data/marketProducts';
import { distinctCurrencies } from './marketFilters';

const key = new Uint8Array(32).fill(7);
const other = new Uint8Array(32).fill(8);
const author = getPublicKey(key);
const authors = new Set([author]);
const event = (fields: Partial<Event> = {}, secret = key) =>
  finalizeEvent(
    {
      kind: 30402,
      created_at: 100,
      content: 'A real seller description',
      tags: [
        ['d', 'product-1'],
        ['title', 'Test listing'],
        ['price', '50', 'USD'],
      ],
      ...fields,
    },
    secret,
  );

describe('market relay listings', () => {
  it('retains fiat prices without inventing a sats quote and uses the signed seller identity', () => {
    const e = event();
    const p = parseMarketListing(e)!;
    expect(p.listing?.priceLabel).toBe('50 USD');
    expect(distinctCurrencies([p])).toEqual(['USD']);
    expect(p.listing?.event).toEqual(e);
    expect(marketCheckoutTarget(p, sellerOf(p))).toBeNull();
    const address = nip19.decode(p.url.split('/').at(-1)!);
    expect(address.type).toBe('naddr');
    expect(marketFeedbackContext(p, sellerOf(p))).toMatchObject({
      productDTag: 'product-1',
      commentRoot: e,
    });
  });
  it('converts BTC to integral sats, but does not invent recurring payment semantics', () => {
    const p = parseMarketListing(
      event({
        tags: [
          ['d', 'x'],
          ['title', 'Book'],
          ['price', '0.00001', 'btc', 'month'],
        ],
      }),
    )!;
    expect(p.priceSats).toBe(1000);
    expect(p.listing?.priceLabel).toBe('0.00001 BTC/month');
    expect(p.checkout).toBeUndefined();
  });
  it('parses available legacy NIP-15 products and hides zero stock or mismatched identifiers', () => {
    const p = {
      id: 'product-1',
      name: 'Book',
      currency: 'SATS',
      price: 1200,
      quantity: null,
      images: ['https://example.com/book.png'],
    };
    expect(parseMarketListing(event({ kind: 30018, content: JSON.stringify(p) }))?.priceSats).toBe(
      1200,
    );
    expect(
      parseMarketListing(event({ kind: 30018, content: JSON.stringify({ ...p, quantity: 0 }) })),
    ).toBeNull();
    expect(
      parseMarketListing(event({ kind: 30018, content: JSON.stringify({ ...p, id: 'wrong' }) })),
    ).toBeNull();
  });
  it('newer sold, expired or malformed revisions suppress older active listings', () => {
    const original = event();
    for (const tags of [
      [...original.tags, ['status', 'sold']],
      [...original.tags, ['expiration', '150']],
      [['d', 'product-1']],
    ]) {
      expect(
        reduceMarketListings([original, event({ created_at: 200, tags })], authors, 300),
      ).toEqual([]);
    }
  });
  it('deduplicates by author and d tag, and rejects authors outside the follow set', () => {
    const newer = event({ created_at: 200 });
    expect(reduceMarketListings([event(), newer, newer, event({}, other)], authors)).toHaveLength(
      1,
    );
    expect(reduceMarketListings([newer, event()], authors)[0].listing?.event.id).toBe(newer.id);
  });
  it('honours author-owned deletions but not third-party deletions or older address tombstones', () => {
    const listing = event();
    const deletion = event({ kind: 5, created_at: 200, tags: [['e', listing.id]] });
    expect(reduceMarketListings([listing, deletion], authors)).toEqual([]);
    expect(
      reduceMarketListings(
        [listing, event({ kind: 5, tags: [['e', listing.id]] }, other)],
        new Set([author, getPublicKey(other)]),
      ),
    ).toHaveLength(1);
    const a = `30402:${author}:product-1`;
    expect(
      reduceMarketListings(
        [listing, event({ kind: 5, created_at: 200, tags: [['a', a]] })],
        authors,
      ),
    ).toEqual([]);
    expect(
      reduceMarketListings(
        [listing, event({ kind: 5, created_at: 50, tags: [['a', a]] })],
        authors,
      ),
    ).toHaveLength(1);
  });
  it.each(['', '-1', 'NaN', 'Infinity', '1e99'])('ignores invalid price %s', (price) => {
    expect(
      parseMarketListing(
        event({
          tags: [
            ['d', 'x'],
            ['title', 'Book'],
            ['price', price, 'USD'],
          ],
        }),
      ),
    ).toBeNull();
  });
  it('ignores drafts and unsafe URLs without using untrusted HTML', () => {
    expect(parseMarketListing(event({ kind: 30403 }))).toBeNull();
    expect(safeMarketUrl('javascript:alert(1)')).toBeNull();
    expect(safeMarketUrl('https://user:pass@example.com')).toBeNull();
    expect(safeMarketUrl('http://example.com')).toBeNull();
    expect(
      parseMarketListing(
        event({
          tags: [
            ['d', 'x'],
            ['title', 'Book'],
            ['price', '1', 'SAT'],
            ['image', 'javascript:evil'],
          ],
        }),
      )?.image,
    ).toBe('');
  });
});
