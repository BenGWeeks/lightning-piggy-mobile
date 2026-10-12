import { walletListsToRender, warmWalletIds } from './warmWalletLists';

const ids = ['a', 'b', 'c', 'd'];

describe('warmWalletIds', () => {
  it('is the active wallet, then right, then left', () => {
    expect(warmWalletIds(ids, 'b')).toEqual(['b', 'c', 'a']);
  });

  it('handles the ends of the carousel', () => {
    expect(warmWalletIds(ids, 'a')).toEqual(['a', 'b']);
    expect(warmWalletIds(ids, 'd')).toEqual(['d', 'c']);
  });

  it('is empty with no active or an unknown wallet', () => {
    expect(warmWalletIds(ids, null)).toEqual([]);
    expect(warmWalletIds(ids, 'zz')).toEqual([]);
  });
});

describe('walletListsToRender', () => {
  it('always renders the active list, even before anything is warm', () => {
    expect(walletListsToRender(ids, 'b', [])).toEqual(['b']);
  });

  it('keeps the previous card mounted when swiping to its neighbour', () => {
    // settled on b: warm = b, c, a. Swipe to c: b stays (it neighbours c), a drops.
    expect(walletListsToRender(ids, 'c', ['b', 'c', 'a'])).toEqual(['b', 'c']);
  });

  it('never renders more than the active card and its two neighbours', () => {
    expect(walletListsToRender(ids, 'c', ids)).toEqual(['b', 'c', 'd']);
  });

  it('renders nothing without an active wallet', () => {
    expect(walletListsToRender(ids, null, ['a', 'b'])).toEqual([]);
  });
});
