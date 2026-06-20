import { hiddenPiggyToParsedCache, mergeHiddenWithDrafts } from './piggyToParsedCache';
import { GC_LISTING_KIND, type ParsedCache } from '../services/nostrPlacesService';
import type { HiddenPiggy } from '../services/piggyStorageService';

const PUBKEY = 'a'.repeat(64);

const makePiggy = (over: Partial<HiddenPiggy> = {}): HiddenPiggy => ({
  id: 'piggy_abc',
  lnurlw: 'LNURL1...',
  createdAt: 1_700_000_000_000, // ms
  isPublic: false,
  ...over,
});

const makeCache = (over: Partial<ParsedCache> = {}): ParsedCache => ({
  coord: `${GC_LISTING_KIND}:${PUBKEY}:cache_d`,
  hiderPubkey: PUBKEY,
  d: 'cache_d',
  name: 'Published Cache',
  description: '',
  geohash: null,
  difficulty: null,
  terrain: null,
  size: null,
  cacheType: null,
  hint: null,
  imageUrl: null,
  isLpPiggy: true,
  waitSeconds: null,
  uses: null,
  payoutSats: null,
  createdAt: 1_700_000_500,
  expiresAt: null,
  ...over,
});

describe('hiddenPiggyToParsedCache', () => {
  it('builds the addressable coord from kind:pubkey:id', () => {
    const c = hiddenPiggyToParsedCache(makePiggy({ id: 'foo' }), PUBKEY);
    expect(c.coord).toBe(`${GC_LISTING_KIND}:${PUBKEY}:foo`);
    expect(c.d).toBe('foo');
    expect(c.hiderPubkey).toBe(PUBKEY);
  });

  it('converts createdAt from ms to unix seconds', () => {
    const c = hiddenPiggyToParsedCache(makePiggy({ createdAt: 1_700_000_000_000 }), PUBKEY);
    expect(c.createdAt).toBe(1_700_000_000);
  });

  it('converts maxWithdrawableMsat to payout sats, null below 1 sat', () => {
    expect(
      hiddenPiggyToParsedCache(makePiggy({ maxWithdrawableMsat: 5_000 }), PUBKEY).payoutSats,
    ).toBe(5);
    expect(
      hiddenPiggyToParsedCache(makePiggy({ maxWithdrawableMsat: 500 }), PUBKEY).payoutSats,
    ).toBeNull();
    expect(hiddenPiggyToParsedCache(makePiggy({}), PUBKEY).payoutSats).toBeNull();
  });

  it('clamps a malformed negative maxWithdrawableMsat to a non-negative payout', () => {
    expect(
      hiddenPiggyToParsedCache(makePiggy({ maxWithdrawableMsat: -5_000 }), PUBKEY).payoutSats,
    ).toBeNull();
  });

  it('treats a record with an LNURL bearer as an LP Piggy', () => {
    expect(hiddenPiggyToParsedCache(makePiggy({ lnurlw: 'LNURL1' }), PUBKEY).isLpPiggy).toBe(true);
  });

  it('honours the isLpPiggy flag even when the bearer is absent', () => {
    expect(
      hiddenPiggyToParsedCache(makePiggy({ lnurlw: '', isLpPiggy: true }), PUBKEY).isLpPiggy,
    ).toBe(true);
    expect(
      hiddenPiggyToParsedCache(makePiggy({ lnurlw: '', isLpPiggy: false }), PUBKEY).isLpPiggy,
    ).toBe(false);
  });

  it('falls back name -> lnurlDescription -> placeholder', () => {
    expect(hiddenPiggyToParsedCache(makePiggy({ name: 'A' }), PUBKEY).name).toBe('A');
    expect(
      hiddenPiggyToParsedCache(makePiggy({ name: undefined, lnurlDescription: 'B' }), PUBKEY).name,
    ).toBe('B');
    expect(
      hiddenPiggyToParsedCache(makePiggy({ name: undefined, lnurlDescription: undefined }), PUBKEY)
        .name,
    ).toBe('Untitled Piglet');
  });
});

describe('mergeHiddenWithDrafts', () => {
  it('surfaces a draft with no published twin as isDraft', () => {
    const rows = mergeHiddenWithDrafts([], [makePiggy({ id: 'draft1' })], PUBKEY);
    expect(rows).toHaveLength(1);
    expect(rows[0].isDraft).toBe(true);
    expect(rows[0].cache.d).toBe('draft1');
  });

  it('does NOT surface a published local record as a draft on cold start (empty cache)', () => {
    // Cold start: peekCachedCachesSync() is empty until AsyncStorage hydrates,
    // but a previously-published Piggy is still in SecureStore (kept for
    // republish) with isPublic === true. It must NOT flash as a Draft row —
    // draft-ness is intrinsic (isPublic === false), not "absent from cache".
    const published = makePiggy({ id: 'live', isPublic: true });
    const rows = mergeHiddenWithDrafts([], [published], PUBKEY);
    expect(rows).toHaveLength(0);
  });

  it('only the isPublic===false record becomes a draft when both are local-only', () => {
    const draft = makePiggy({ id: 'draft', isPublic: false });
    const live = makePiggy({ id: 'live', isPublic: true });
    const rows = mergeHiddenWithDrafts([], [draft, live], PUBKEY);
    expect(rows).toHaveLength(1);
    expect(rows[0].cache.d).toBe('draft');
    expect(rows[0].isDraft).toBe(true);
  });

  it('lets a published cache win over its local draft twin (dedupe by coord)', () => {
    const piggy = makePiggy({ id: 'shared', name: 'Local draft name' });
    const published = makeCache({
      coord: `${GC_LISTING_KIND}:${PUBKEY}:shared`,
      d: 'shared',
      name: 'Published name',
    });
    const rows = mergeHiddenWithDrafts([published], [piggy], PUBKEY);
    expect(rows).toHaveLength(1);
    expect(rows[0].isDraft).toBe(false);
    expect(rows[0].cache.name).toBe('Published name');
  });

  it('dedupes published-vs-draft even when published coord/pubkey casing differs', () => {
    // Relay-sourced caches can come back with an upper-cased hex pubkey in
    // both `coord` and `hiderPubkey`; the local draft twin is built from the
    // lower-case local pubkey. They must still dedupe to a single row.
    const piggy = makePiggy({ id: 'shared', name: 'Local draft name' });
    const published = makeCache({
      coord: `${GC_LISTING_KIND}:${PUBKEY.toUpperCase()}:shared`,
      hiderPubkey: PUBKEY.toUpperCase(),
      d: 'shared',
      name: 'Published name',
    });
    const rows = mergeHiddenWithDrafts([published], [piggy], PUBKEY);
    expect(rows).toHaveLength(1);
    expect(rows[0].isDraft).toBe(false);
    expect(rows[0].cache.name).toBe('Published name');
  });

  it('excludes published caches authored by someone else', () => {
    const other = makeCache({
      coord: `${GC_LISTING_KIND}:${'b'.repeat(64)}:x`,
      hiderPubkey: 'b'.repeat(64),
      d: 'x',
    });
    expect(mergeHiddenWithDrafts([other], [], PUBKEY)).toHaveLength(0);
  });

  it('matches author case-insensitively', () => {
    const upper = makeCache({
      coord: `${GC_LISTING_KIND}:${PUBKEY.toUpperCase()}:y`,
      hiderPubkey: PUBKEY.toUpperCase(),
      d: 'y',
    });
    expect(mergeHiddenWithDrafts([upper], [], PUBKEY)).toHaveLength(1);
  });

  it('sorts rows newest-first by createdAt', () => {
    const older = makePiggy({ id: 'older', createdAt: 1_000_000_000_000 });
    const newer = makePiggy({ id: 'newer', createdAt: 2_000_000_000_000 });
    const rows = mergeHiddenWithDrafts([], [older, newer], PUBKEY);
    expect(rows.map((r) => r.cache.d)).toEqual(['newer', 'older']);
  });

  it('returns both a published cache and an unrelated draft', () => {
    const published = makeCache({ coord: `${GC_LISTING_KIND}:${PUBKEY}:pub`, d: 'pub' });
    const rows = mergeHiddenWithDrafts([published], [makePiggy({ id: 'draftonly' })], PUBKEY);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.cache.d === 'pub')?.isDraft).toBe(false);
    expect(rows.find((r) => r.cache.d === 'draftonly')?.isDraft).toBe(true);
  });
});
