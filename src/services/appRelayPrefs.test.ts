import AsyncStorage from '@react-native-async-storage/async-storage';
import { setCurrentUserPubkey } from './nostrActiveAccount';
import { TEST_ACCOUNT_PUBKEYS, TEST_RELAY_URL } from '../config/testRelayLockdown';
import { perAccountKey } from './perAccountStorage';
import {
  APP_RELAY_PREFS_KEY,
  enabledAppRelays,
  forgetAppRelayPrefs,
  isAppRelayEnabled,
  loadAppRelayPrefs,
  setAppRelayEnabled,
  subscribeAppRelayPrefs,
  type AppRelayGroup,
} from './appRelayPrefs';

const alice = 'a'.repeat(64);
const bob = 'b'.repeat(64);
const relays = ['wss://one.example', 'wss://two.example'];
beforeEach(async () => {
  setCurrentUserPubkey(null);
  await forgetAppRelayPrefs(alice);
  await forgetAppRelayPrefs(bob);
  await AsyncStorage.clear();
});

it.each<AppRelayGroup>(['default', 'indexers', 'geocache', 'marmot', 'market'])(
  'persists and filters %s independently per account',
  async (group) => {
    await loadAppRelayPrefs(alice);
    expect(enabledAppRelays(group, relays, alice)).toEqual(relays);
    await setAppRelayEnabled(alice, group, relays[0] + '/', false);
    expect(enabledAppRelays(group, relays, alice)).toEqual([relays[1]]);
    expect(isAppRelayEnabled(alice, group, relays[0])).toBe(false);
    expect(
      JSON.parse((await AsyncStorage.getItem(perAccountKey(APP_RELAY_PREFS_KEY, alice)))!)[group],
    ).toEqual([relays[0]]);
    await forgetAppRelayPrefs(alice);
    await loadAppRelayPrefs(alice);
    await loadAppRelayPrefs(bob);
    expect(enabledAppRelays(group, relays, alice)).toEqual([relays[1]]);
    expect(enabledAppRelays(group, relays, bob)).toEqual(relays);
    setCurrentUserPubkey(alice);
    expect(enabledAppRelays(group, relays)).toEqual([relays[1]]);
    await setAppRelayEnabled(alice, group, relays[0], true);
    expect(enabledAppRelays(group, relays)).toEqual(relays);
  },
);
it('keeps unknown account defaults closed until hydration, and handles malformed storage', async () => {
  expect(enabledAppRelays('default', relays, alice)).toEqual([]);
  await AsyncStorage.setItem(perAccountKey(APP_RELAY_PREFS_KEY, alice), '{broken');
  await loadAppRelayPrefs(alice);
  expect(enabledAppRelays('default', relays, alice)).toEqual(relays);
});
it('serializes rapid toggles and notifies only after persistence', async () => {
  await loadAppRelayPrefs(alice);
  const listener = jest.fn();
  const off = subscribeAppRelayPrefs(listener);
  await Promise.all([
    setAppRelayEnabled(alice, 'market', relays[0], false),
    setAppRelayEnabled(alice, 'market', relays[0], true),
  ]);
  expect(listener).toHaveBeenCalledTimes(2);
  expect(enabledAppRelays('market', relays, alice)).toEqual(relays);
  off();
});
it('keeps lockdown authoritative even with every preference off', async () => {
  const test = [...TEST_ACCOUNT_PUBKEYS][0];
  for (const group of ['default', 'indexers', 'geocache', 'marmot', 'market'] as const) {
    for (const url of relays) await setAppRelayEnabled(test, group, url, false);
    expect(enabledAppRelays(group, relays, test)).toEqual([TEST_RELAY_URL]);
    expect(enabledAppRelays(group, [], test)).toEqual([TEST_RELAY_URL]);
  }
  await forgetAppRelayPrefs(test);
});
it('allows an empty group without restoring fallback relays', async () => {
  for (const url of relays) await setAppRelayEnabled(alice, 'market', url, false);
  expect(enabledAppRelays('market', relays, alice)).toEqual([]);
});

it('uses one preference set for different pubkey casing', async () => {
  await setAppRelayEnabled(alice.toUpperCase(), 'default', relays[0], false);
  expect(enabledAppRelays('default', relays, alice)).toEqual([relays[1]]);
  expect(enabledAppRelays('default', relays, alice.toUpperCase())).toEqual([relays[1]]);
});

it('preserves the list identity when no filtering is needed', async () => {
  expect(enabledAppRelays('default', relays, null)).toBe(relays);
  await loadAppRelayPrefs(alice);
  expect(enabledAppRelays('default', relays, alice)).toBe(relays);
});
