// The dev-leftover denylist is enforced at relay ingestion, but blobs
// persisted before a signer was denylisted still carry it. These guard
// that nostrPlacesStorage re-applies the denylist on both read (hydrate)
// and write (saveCaches/saveEvents) so orphaned "Geo-Cache 1" stashes
// stop painting from disk (#699).
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ParsedCache, ParsedEvent } from './nostrPlacesService';
import {
  clearCacheStorage,
  loadCachedCaches,
  loadCachedEvents,
  peekCachedCachesSync,
  peekCachedEventsSync,
  saveCaches,
  saveEvents,
} from './nostrPlacesStorage';

const CACHES_STORAGE_KEY = '@lp:nostr-caches-v1';
const EVENTS_STORAGE_KEY = '@lp:nostr-events-v1';

// One of the four disposable signers of d=big-piggy-geo-cache-1 in
// devEventDenylist.ts ("Geo-Cache 1").
const DENYLISTED = 'b8d38e654adff224418002ae752155a84a86dab6fa94b4bc9e81ca9e25dce9e7';
const CLEAN = 'feed'.repeat(16);

const cache = (hiderPubkey: string, name: string): ParsedCache => ({
  coord: `37516:${hiderPubkey}:${name}`,
  hiderPubkey,
  d: name,
  name,
  description: '',
  geohash: null,
  difficulty: null,
  terrain: null,
  size: null,
  cacheType: null,
  hint: null,
  imageUrl: null,
  isLpPiggy: false,
  waitSeconds: null,
  uses: null,
  payoutSats: null,
  createdAt: 1_000,
  expiresAt: null,
});

const event = (organiserPubkey: string, title: string): ParsedEvent => ({
  coord: `31923:${organiserPubkey}:${title}`,
  organiserPubkey,
  d: title,
  title,
  description: '',
  startsAt: 1_000,
  endsAt: null,
  location: null,
  geohash: null,
  imageUrl: null,
  hashtags: [],
});

// clearCacheStorage resets the module's hydrate gate so a later
// loadCached* re-reads whatever we seeded.
const seedAndRehydrate = async (key: string, items: unknown[]) => {
  await clearCacheStorage();
  await AsyncStorage.setItem(key, JSON.stringify({ fetchedAt: Date.now(), items }));
};

describe('nostrPlacesStorage denylist enforcement (#699)', () => {
  beforeEach(async () => {
    await clearCacheStorage();
    await AsyncStorage.clear();
  });

  it('drops a denylisted cache persisted in the on-disk blob on hydrate', async () => {
    await seedAndRehydrate(CACHES_STORAGE_KEY, [
      cache(DENYLISTED, 'Geo-Cache 1'),
      cache(CLEAN, 'The Hawthorn Hideaway!'),
    ]);
    const loaded = await loadCachedCaches();
    expect(loaded.map((c) => c.name)).toEqual(['The Hawthorn Hideaway!']);
  });

  it('drops a denylisted event persisted in the on-disk blob on hydrate', async () => {
    await seedAndRehydrate(EVENTS_STORAGE_KEY, [
      event(DENYLISTED, 'Junk'),
      event(CLEAN, 'Real Meetup'),
    ]);
    const loaded = await loadCachedEvents();
    expect(loaded.map((e) => e.title)).toEqual(['Real Meetup']);
  });

  it('never persists a denylisted cache via saveCaches', async () => {
    saveCaches([cache(DENYLISTED, 'Geo-Cache 1'), cache(CLEAN, 'Keeper')]);
    expect(peekCachedCachesSync().map((c) => c.name)).toEqual(['Keeper']);
    const raw = await AsyncStorage.getItem(CACHES_STORAGE_KEY);
    expect(raw).not.toContain(DENYLISTED);
  });

  it('never persists a denylisted event via saveEvents', async () => {
    saveEvents([event(DENYLISTED, 'Junk'), event(CLEAN, 'Keeper')]);
    expect(peekCachedEventsSync().map((e) => e.title)).toEqual(['Keeper']);
    const raw = await AsyncStorage.getItem(EVENTS_STORAGE_KEY);
    expect(raw).not.toContain(DENYLISTED);
  });

  it('keeps clean entries untouched on hydrate', async () => {
    await seedAndRehydrate(CACHES_STORAGE_KEY, [cache(CLEAN, 'A'), cache(CLEAN, 'B')]);
    expect((await loadCachedCaches()).length).toBe(2);
  });

  it('rewrites the sanitized blob to disk when hydrate drops entries (no re-filter every start)', async () => {
    await seedAndRehydrate(CACHES_STORAGE_KEY, [
      cache(DENYLISTED, 'Geo-Cache 1'),
      cache(CLEAN, 'Keeper'),
    ]);
    await loadCachedCaches();
    // The on-disk blob itself should now be clean, not just the in-memory mirror.
    const raw = await AsyncStorage.getItem(CACHES_STORAGE_KEY);
    expect(raw).not.toContain(DENYLISTED);
  });

  it('does not rewrite the blob when nothing is dropped', async () => {
    await seedAndRehydrate(CACHES_STORAGE_KEY, [cache(CLEAN, 'A')]);
    const setSpy = jest.spyOn(AsyncStorage, 'setItem');
    setSpy.mockClear(); // drop the seed write's history (shared mock fn) so we only see hydrate
    await loadCachedCaches();
    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
  });
});
