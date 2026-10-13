import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NavigationState } from '@react-navigation/native';
import {
  NAV_STATE_KEY,
  persistNavigationState,
  loadPersistedNavigationState,
  sanitizeNavigationState,
} from './navigationStatePersistence';
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
beforeEach(async () => {
  await AsyncStorage.clear();
});

it('does not persist private chat media snapshots or replay message jumps', async () => {
  const state = {
    index: 2,
    routeNames: ['Main', 'Conversation', 'ChatMedia'],
    routes: [
      { key: 'main', name: 'Main' },
      { key: 'chat', name: 'Conversation', params: { pubkey: 'peer', jumpToMessage: 'old-id' } },
      {
        key: 'media',
        name: 'ChatMedia',
        params: {
          messages: [
            { id: 'm', text: 'private-chat-attachment#lpe=1&k=fake-test-key', createdAt: 1 },
          ],
          target: { screen: 'Conversation', params: { pubkey: 'peer' } },
        },
      },
    ],
  } as unknown as NavigationState;
  const before = JSON.stringify(state);
  await persistNavigationState(state);
  const raw = (await AsyncStorage.getItem(NAV_STATE_KEY))!;
  expect(raw).not.toContain('private-chat-attachment');
  expect(raw).not.toContain('fake-test-key');
  expect(raw).not.toContain('jumpToMessage');
  const restored = await loadPersistedNavigationState();
  expect(restored?.routes.map((r) => r.name)).toEqual(['Main', 'Conversation']);
  expect(restored?.index).toBe(1);
  expect(JSON.stringify(state)).toBe(before);
});

it('strips media message payloads even from a malformed media-only stack', () => {
  const state = {
    index: 0,
    routeNames: ['ChatMedia'],
    routes: [{ key: 'media', name: 'ChatMedia', params: { messages: [{ text: 'private' }] } }],
  } as unknown as NavigationState;
  expect(JSON.stringify(sanitizeNavigationState(state))).not.toContain('private');
});
