import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNip65Relays } from './useNip65Relays';
import { fetchLatestReplaceable } from '../services/nostrRelayLists';
import * as nostrService from '../services/nostrService';

jest.mock('../services/nostrRelayLists', () => ({ fetchLatestReplaceable: jest.fn() }));
jest.mock('../services/nostrService', () => ({
  DEFAULT_RELAYS: ['wss://relay.damus.io'],
  fetchRelayList: jest.fn(),
}));
const fetchLatest = fetchLatestReplaceable as jest.Mock;
const inboxEvent = (urls: string[]) => ({ kind: 10050, tags: urls.map((u) => ['relay', u]) });
const fetchList = nostrService.fetchRelayList as jest.Mock;
const PK = 'a'.repeat(64);

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  fetchList.mockResolvedValue([{ url: 'wss://relay.primal.net', read: true, write: true }]);
});

it("loads the user's own DM inbox relays alongside NIP-65, so the app reads them", async () => {
  fetchLatest.mockResolvedValue(inboxEvent(['wss://nostr.mom', 'wss://relay.snort.social']));
  const { result } = renderHook(() => useNip65Relays());
  await act(async () => {
    await result.current.loadRelays(PK);
  });
  await waitFor(() =>
    expect(result.current.dmInboxRelays).toEqual(['wss://nostr.mom', 'wss://relay.snort.social']),
  );
});

it('adopts published DM inbox relays immediately and clears both lists on reset', async () => {
  fetchLatest.mockResolvedValue(null);
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

it('ignores a slow inbox load that finishes after an identity reset', async () => {
  let finish!: (v: unknown) => void;
  fetchLatest.mockReturnValue(new Promise((r) => (finish = r)));
  const { result } = renderHook(() => useNip65Relays());
  await act(async () => {
    await result.current.loadRelays(PK);
  });
  act(() => result.current.resetRelayLists()); // logout / switch while still loading
  await act(async () => {
    finish(inboxEvent(['wss://old-account.example']));
  });
  expect(result.current.dmInboxRelays).toEqual([]);
});
