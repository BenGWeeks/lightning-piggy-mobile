import {
  NIP09_DELETION_KIND,
  buildDeletionRequest,
  buildExpireNowListing,
  deletePiggy,
} from './deletePiggyService';
import { GC_LISTING_KIND } from './nostrPlacesService';
import type { HiddenPiggy } from './piggyStorageService';
import { publishCacheEvent, type SignedEventLike } from './nostrPlacesPublisher';

// Mock the runtime publish layer so the orchestrator test never touches
// nostr-tools' relay pool. The pure builders don't need this — they only
// pull `buildCacheListing` / `GC_LISTING_KIND` from the pure module.
// `jest.mock` is hoisted above the import, so `publishCacheEvent` is the mock.
jest.mock('./nostrPlacesPublisher', () => ({
  publishCacheEvent: jest.fn(async () => {}),
}));
const mockPublish = publishCacheEvent as jest.Mock;

const NOW = 1_800_000_000;

// A fully-populated Piglet — buildCacheListing needs lat/lon, and we
// assert the LNURL bearer never leaks onto either published event.
const basePiggy = (over: Partial<HiddenPiggy> = {}): HiddenPiggy => ({
  id: 'piggy-1',
  lnurlw: 'lnurl1secretbearertoken',
  createdAt: 1_700_000_000_000,
  isPublic: true,
  lat: 52.2,
  lon: 0.12,
  name: 'Swavesey Stash',
  expiresAt: 1_700_000_000 + 30 * 24 * 60 * 60,
  ...over,
});

const COORD = `${GC_LISTING_KIND}:abc123pubkey:piggy-1`;

describe('buildExpireNowListing', () => {
  it('pins the NIP-40 expiration tag AND created_at to nowSec, under the same d', () => {
    const ev = buildExpireNowListing(basePiggy(), NOW);
    expect(ev.kind).toBe(GC_LISTING_KIND);
    expect(ev.tags).toContainEqual(['expiration', String(NOW)]);
    expect(ev.tags).toContainEqual(['d', 'piggy-1']);
    // created_at pinned to nowSec (not buildCacheListing's Date.now()) so the
    // listing never ends up newer than the kind-5 deletion that follows.
    expect(ev.created_at).toBe(NOW);
  });

  it('never leaks the LNURL bearer onto the published listing', () => {
    const ev = buildExpireNowListing(basePiggy(), NOW);
    const serialised = JSON.stringify(ev);
    expect(serialised).not.toContain('lnurl1secretbearertoken');
  });
});

describe('buildDeletionRequest', () => {
  it('references the addressable coord via an `a` tag + `k` kind hint', () => {
    const ev = buildDeletionRequest([COORD], NOW);
    expect(ev.kind).toBe(NIP09_DELETION_KIND);
    expect(ev.kind).toBe(5);
    expect(ev.created_at).toBe(NOW);
    expect(ev.tags).toContainEqual(['a', COORD]);
    expect(ev.tags).toContainEqual(['k', String(GC_LISTING_KIND)]);
    // Never an `e` tag — kind 37516 is replaceable, deleted by coord.
    expect(ev.tags.some((t) => t[0] === 'e')).toBe(false);
  });

  it('emits one `a` tag per coord', () => {
    const ev = buildDeletionRequest([COORD, `${GC_LISTING_KIND}:abc:piggy-2`], NOW);
    expect(ev.tags.filter((t) => t[0] === 'a')).toHaveLength(2);
  });
});

describe('deletePiggy', () => {
  const signed = (over: Partial<SignedEventLike>): SignedEventLike => ({
    id: 'id',
    pubkey: 'abc123pubkey',
    sig: 'sig',
    kind: 0,
    created_at: NOW,
    tags: [],
    content: '',
    ...over,
  });

  beforeEach(() => {
    mockPublish.mockClear();
  });

  it('expires first, THEN sends the kind-5 deletion (strict order)', async () => {
    const order: number[] = [];
    const signEvent = jest.fn(async (tpl: { kind: number }) => {
      order.push(tpl.kind);
      return signed({ kind: tpl.kind });
    });
    mockPublish.mockImplementation(async (ev: SignedEventLike) => {
      order.push(ev.kind + 1000); // offset so publish calls are distinguishable
    });

    const res = await deletePiggy({ coord: COORD, piggy: basePiggy(), signEvent, nowSec: NOW });

    expect(res).toEqual({ expired: true, deletionRequested: true });
    // sign(37516) → publish(37516) → sign(5) → publish(5)
    expect(order).toEqual([GC_LISTING_KIND, GC_LISTING_KIND + 1000, 5, 1005]);
  });

  it('sends the deletion only (no expire step) when no local piggy is held', async () => {
    const signEvent = jest.fn(async (tpl: { kind: number }) => signed({ kind: tpl.kind }));
    const res = await deletePiggy({ coord: COORD, signEvent, nowSec: NOW });

    expect(res).toEqual({ expired: false, deletionRequested: true });
    expect(signEvent).toHaveBeenCalledTimes(1);
    expect(signEvent.mock.calls[0][0].kind).toBe(NIP09_DELETION_KIND);
    expect(mockPublish).toHaveBeenCalledTimes(1);
  });

  it('throws (and skips step 2) when the signer declines the expire step', async () => {
    const signEvent = jest.fn(async () => null);
    await expect(
      deletePiggy({ coord: COORD, piggy: basePiggy(), signEvent, nowSec: NOW }),
    ).rejects.toThrow(/not deleted/);
    expect(signEvent).toHaveBeenCalledTimes(1); // never reached the deletion
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('throws when the signer declines the deletion step', async () => {
    const signEvent = jest.fn(async (tpl: { kind: number }) =>
      tpl.kind === NIP09_DELETION_KIND ? null : signed({ kind: tpl.kind }),
    );
    await expect(
      deletePiggy({ coord: COORD, piggy: basePiggy(), signEvent, nowSec: NOW }),
    ).rejects.toThrow(/deletion request not sent/);
    // Step 1 still published before step 2 declined.
    expect(mockPublish).toHaveBeenCalledTimes(1);
  });
});
