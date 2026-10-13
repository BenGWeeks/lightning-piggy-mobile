import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadChatClearBoundary, saveChatClearBoundary, chatHistoryKey } from './chatLocalHistory';
beforeEach(async () => {
  await AsyncStorage.clear();
});
it('keeps clear boundaries isolated by account, peer and protocol', async () => {
  expect(await loadChatClearBoundary('a', 'nip17:b')).toEqual({ at: 0, hidden: [] });
  await saveChatClearBoundary('A', 'nip17:b', {
    at: 123,
    hidden: [{ id: 'future', createdAt: 456 }],
  });
  expect(await loadChatClearBoundary('a', 'nip17:b')).toEqual({
    at: 123,
    hidden: [{ id: 'future', createdAt: 456 }],
  });
  expect(await loadChatClearBoundary('c', 'nip17:b')).toEqual({ at: 0, hidden: [] });
  expect(await loadChatClearBoundary('a', 'marmot:b')).toEqual({ at: 0, hidden: [] });
  expect(await loadChatClearBoundary('a', 'nip17:c')).toEqual({ at: 0, hidden: [] });
});
it.each(['bad', '-1', 'Infinity'])('ignores invalid stored boundaries: %s', async (value) => {
  await AsyncStorage.setItem(chatHistoryKey('a', 'b'), value);
  expect(await loadChatClearBoundary('a', 'b')).toEqual({ at: 0, hidden: [] });
});

it('reads legacy numeric cutoffs', async () => {
  await AsyncStorage.setItem(chatHistoryKey('a', 'b'), '123');
  expect(await loadChatClearBoundary('a', 'b')).toEqual({ at: 123, hidden: [] });
});
