import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNip65Relays } from './useNip65Relays';
import { fetchDmInboxRelays } from '../services/nostrRelayLists';
import * as nostrService from '../services/nostrService';

jest.mock('../services/nostrRelayLists', () => ({ fetchDmInboxRelays: jest.fn() }));
jest.mock('../services/nostrService', () => ({
  DEFAULT_RELAYS: ['wss://relay.damus.io'],
  fetchRelayList: jest.fn(),
}));
const fetchInbox = fetchDmInboxRelays as jest.Mock;
const fetchList = nostrService.fetchRelayList as jest.Mock;
const PK = 'a'.repeat(64);

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  fetchList.mockResolvedValue([{ url: 'wss://relay.primal.net', read: true, write: true }]);
});

it("loads the user's own DM inbox relays alongside NIP-65, so the app reads them", async () => {
  fetchInbox.mockResolvedValue(['wss://nostr.mom', 'wss://relay.snort.social']);
  const { result } = renderHook(() => useNip65Relays());
  await act(async () => {
    await result.current.loadRelays(PK);
  });
  await waitFor(() =>
    expect(result.current.dmInboxRelays).toEqual(['wss://nostr.mom', 'wss://relay.snort.social']),
  );
});

it('adopts published DM inbox relays immediately and clears both lists on reset', async () => {
  fetchInbox.mockResolvedValue(null);
  const { result } = renderHook(() => useNip65Relays());
  await act(async () => {
    await result.current.applyPublishedDmInbox(PK, ['wss://nostr.mom']);
    await result.current.applyPublishedRelayList(PK, [
      { url: 'wss://nostr.mom', read: true, write: true },
    ]);
  });
  expect(result.current.dmInboxRelays).toEqual(['wss://nostr.mom']);
  expect(result.current.nip65Relays).toHaveLength(1);
  act(() => result.current.resetRelayLists());
  expect(result.current.dmInboxRelays).toEqual([]);
  expect(result.current.nip65Relays).toEqual([]);
});
