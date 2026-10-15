import AsyncStorage from '@react-native-async-storage/async-storage';
import { readOrderCounterpartyProfiles } from './orderCounterpartyProfiles';
import * as cache from './zapSenderProfileStorage';
import { perAccountKey } from './perAccountStorage';
import { OWN_PROFILE_CACHE_KEY_BASE } from '../contexts/nostrCacheKeys';

jest.mock('./zapSenderProfileStorage', () => ({ getMany: jest.fn() }));
const OWNER = 'a'.repeat(64);
const PEER = 'b'.repeat(64);
const LOCAL = 'c'.repeat(64);
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.mocked(cache.getMany).mockImplementation(async () => new Map());
});
it('reads Messages peers and cached signed-in profiles without exposing payment metadata', async () => {
  await AsyncStorage.setItem(
    `nonfollow_profiles_${OWNER}`,
    JSON.stringify({
      [PEER]: { npub: 'peer', name: 'Little Piggy', picture: 'peer.png', lud16: 'unverified' },
    }),
  );
  await AsyncStorage.setItem(
    perAccountKey(OWN_PROFILE_CACHE_KEY_BASE, LOCAL),
    JSON.stringify({
      pubkey: LOCAL,
      npub: 'local',
      displayName: 'Big Piggy',
      picture: 'local.png',
    }),
  );
  const profiles = await readOrderCounterpartyProfiles(OWNER, [PEER, LOCAL]);
  expect(profiles.get(PEER)).toEqual({
    npub: 'peer',
    name: 'Little Piggy',
    displayName: null,
    picture: 'peer.png',
    nip05: null,
  });
  expect(profiles.get(LOCAL)?.displayName).toBe('Big Piggy');
  expect(profiles.get(LOCAL)?.picture).toBe('local.png');
  expect(profiles.get(PEER)).not.toHaveProperty('lud16');
  expect((await readOrderCounterpartyProfiles('other', [PEER])).size).toBe(0);
});
it('ignores corrupt or mismatched identity entries and retains the shared cache', async () => {
  const cached = { npub: 'peer', name: 'Cached', displayName: null, picture: null, nip05: null };
  jest.mocked(cache.getMany).mockImplementation(async () => new Map([[PEER, cached]]));
  await AsyncStorage.setItem(`nonfollow_profiles_${OWNER}`, '{bad');
  await AsyncStorage.setItem(
    perAccountKey(OWN_PROFILE_CACHE_KEY_BASE, PEER),
    JSON.stringify({ pubkey: LOCAL, npub: 'wrong', name: 'Wrong' }),
  );
  expect((await readOrderCounterpartyProfiles(OWNER, [PEER])).get(PEER)).toEqual(cached);
});
