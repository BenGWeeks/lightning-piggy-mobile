import { buildProfileRows, chunk, collectMediaTiles, sortFeed } from './profileFeedRows';
import type { AuthorFeedEvent } from '../services/authorFeedService';
import type { MarketProduct } from '../data/marketProducts';

const ev = (
  id: string,
  created_at: number,
  over: Partial<AuthorFeedEvent> = {},
): AuthorFeedEvent => ({
  id,
  pubkey: 'p',
  kind: 1,
  created_at,
  content: '',
  tags: [],
  ...over,
});
const product = (id: string) => ({ id }) as MarketProduct;
const base = { feed: [], feedLoading: false, products: [], productsLoading: false };

describe('sortFeed / chunk', () => {
  it('sorts newest first with a stable id tie-break', () => {
    expect(sortFeed([ev('b', 1), ev('c', 2), ev('a', 1)]).map((e) => e.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('chunks into fixed-size rows', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe('collectMediaTiles', () => {
  it('collects media across events, dropping repeated URLs', () => {
    const tiles = collectMediaTiles([
      ev('1', 2, { content: 'https://x.example/a.png https://x.example/b.mp4' }),
      ev('2', 1, { content: 'again https://x.example/a.png' }),
      ev('3', 1, { kind: 20, tags: [['imeta', 'url https://x.example/c']] }),
    ]);
    expect(tiles.map((t) => [t.eventId, t.item.type])).toEqual([
      ['1', 'image'],
      ['1', 'video'],
      ['3', 'image'],
    ]);
  });
});

describe('buildProfileRows', () => {
  it('shows only kind-1 notes on Posts', () => {
    const rows = buildProfileRows({
      ...base,
      tab: 'posts',
      feed: [ev('1', 2), ev('2', 1, { kind: 20 })],
    });
    expect(rows).toEqual([{ type: 'post', key: '1', event: ev('1', 2) }]);
  });

  it('shows loading then empty status rows', () => {
    expect(buildProfileRows({ ...base, tab: 'posts', feedLoading: true })[0]).toMatchObject({
      status: 'loading',
    });
    expect(buildProfileRows({ ...base, tab: 'media' })[0]).toMatchObject({ status: 'emptyMedia' });
    expect(buildProfileRows({ ...base, tab: 'products' })[0]).toMatchObject({
      status: 'emptyProducts',
    });
  });

  it('says listings could not be loaded rather than "nothing for sale"', () => {
    expect(
      buildProfileRows({ ...base, tab: 'products', productsIncomplete: true })[0],
    ).toMatchObject({ status: 'productsUnavailable' });
  });

  it('chunks media into rows of three and products into rows of two', () => {
    const feed = [
      ev('1', 1, { content: [1, 2, 3, 4].map((n) => `https://x.example/${n}.jpg`).join(' ') }),
    ];
    const media = buildProfileRows({ ...base, tab: 'media', feed });
    expect(media.map((r) => (r.type === 'media' ? r.tiles.length : 0))).toEqual([3, 1]);
    const products = buildProfileRows({
      ...base,
      tab: 'products',
      products: [product('a'), product('b'), product('c')],
    });
    expect(products.map((r) => r.key)).toEqual(['products-a', 'products-c']);
  });
});
