import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadChatClearBoundary, saveChatClearBoundary, chatHistoryKey } from './chatLocalHistory';
beforeEach(async () => {
  await AsyncStorage.clear();
});
it('keeps clear boundaries isolated by account, peer and protocol', async () => {
  expect(await loadChatClearBoundary('a', 'nip17:b')).toBe(0);
  await saveChatClearBoundary('A', 'nip17:b', 123);
  expect(await loadChatClearBoundary('a', 'nip17:b')).toBe(123);
  expect(await loadChatClearBoundary('c', 'nip17:b')).toBe(0);
  expect(await loadChatClearBoundary('a', 'marmot:b')).toBe(0);
  expect(await loadChatClearBoundary('a', 'nip17:c')).toBe(0);
});
it.each(['bad', '-1', 'Infinity'])('ignores invalid stored boundaries: %s', async (value) => {
  await AsyncStorage.setItem(chatHistoryKey('a', 'b'), value);
  expect(await loadChatClearBoundary('a', 'b')).toBe(0);
});
