import {
  buildProfileRows,
  chunk,
  collectMediaTiles,
  countTopLevelPosts,
  sortFeed,
} from './profileFeedRows';
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
    expect(rows).toEqual([{ type: 'post', key: '1', event: ev('1', 2), reply: null }]);
  });

  it('hides replies by default and shows them with context in Posts & replies', () => {
    const parent = '2'.repeat(64);
    const feed = [
      ev('top', 3),
      ev('re', 2, { tags: [['e', parent, '', 'reply', 'b'.repeat(64)]] }),
      ev('quote', 1, { tags: [['q', parent]] }),
    ];
    const posts = buildProfileRows({ ...base, tab: 'posts', feed });
    expect(posts.map((r) => r.key)).toEqual(['top', 'quote']);
    const all = buildProfileRows({ ...base, tab: 'posts', postsMode: 'all', feed });
    expect(all.map((r) => r.key)).toEqual(['top', 're', 'quote']);
    const reply = all[1];
    expect(reply.type === 'post' && reply.reply?.ref.id).toBe(parent);
    expect(reply.type === 'post' && reply.reply?.authorPubkey).toBe('b'.repeat(64));
    expect(all[0].type === 'post' && all[0].reply).toBeNull();
    expect(countTopLevelPosts(feed)).toBe(2);
  });

  it('says when only replies are loaded in Posts mode', () => {
    const feed = [ev('re', 2, { tags: [['e', '2'.repeat(64)]] })];
    expect(buildProfileRows({ ...base, tab: 'posts', feed })[0]).toMatchObject({
      status: 'onlyReplies',
    });
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
