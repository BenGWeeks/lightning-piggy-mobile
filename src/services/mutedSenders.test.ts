import AsyncStorage from '@react-native-async-storage/async-storage';
import { perAccountKey } from './perAccountStorage';
import {
  isMutedNotification,
  loadMutedSenders,
  MUTED_SENDERS_KEY,
  shouldMuteNotification,
  subscribeMutedSenders,
  toggleMutedSender,
} from './mutedSenders';

const OWNER = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const PEER = 'c'.repeat(64);
beforeEach(async () => {
  await AsyncStorage.clear();
});

it('persists hex pubkeys under the account key and toggles back to unmuted', async () => {
  await toggleMutedSender(OWNER, PEER.toUpperCase());
  expect(
    JSON.parse((await AsyncStorage.getItem(perAccountKey(MUTED_SENDERS_KEY, OWNER)))!),
  ).toEqual([PEER]);
  expect(await loadMutedSenders(OWNER)).toEqual(new Set([PEER]));
  expect(await loadMutedSenders(OTHER)).toEqual(new Set());
  await toggleMutedSender(OWNER, PEER);
  expect(await loadMutedSenders(OWNER)).toEqual(new Set());
});
it('serializes concurrent toggles without losing changes and notifies subscribers', async () => {
  const listener = jest.fn();
  const unsubscribe = subscribeMutedSenders(listener);
  await Promise.all([toggleMutedSender(OWNER, PEER), toggleMutedSender(OWNER, OTHER)]);
  expect(await loadMutedSenders(OWNER)).toEqual(new Set([PEER, OTHER]));
  expect(listener).toHaveBeenCalledTimes(2);
  await Promise.all([toggleMutedSender(OWNER, PEER), toggleMutedSender(OWNER, PEER)]);
  expect(await loadMutedSenders(OWNER)).toEqual(new Set([PEER, OTHER]));
  unsubscribe();
});
it('reads durable background-context preferences, ignores malformed values, and rejects invalid senders', async () => {
  const key = perAccountKey(MUTED_SENDERS_KEY, OWNER);
  await AsyncStorage.setItem(key, JSON.stringify([PEER, 'invalid', 42]));
  expect(
    await shouldMuteNotification(OWNER, { conversationPubkey: PEER.toUpperCase() }, 'dm'),
  ).toBe(true);
  expect(await shouldMuteNotification(OTHER, { conversationPubkey: PEER }, 'dm')).toBe(false);
  await AsyncStorage.setItem(key, 'broken JSON');
  expect(await loadMutedSenders(OWNER)).toEqual(new Set());
  await expect(toggleMutedSender(OWNER, 'invalid')).rejects.toThrow();
});
it('filters sender metadata without treating wallet IDs or group IDs as senders', () => {
  const muted = new Set([PEER]);
  expect(isMutedNotification({ conversationPubkey: PEER.toUpperCase() }, 'dm', muted)).toBe(true);
  expect(isMutedNotification({ senderPubkey: PEER }, 'group', muted)).toBe(true);
  expect(isMutedNotification({ conversationPubkey: OTHER }, 'dm', muted)).toBe(false);
  expect(isMutedNotification({ walletId: PEER }, 'payment', muted)).toBe(false);
  expect(isMutedNotification({ groupId: PEER }, 'group', muted)).toBe(false);
  expect(isMutedNotification({}, 'dm', muted)).toBe(false);
});
