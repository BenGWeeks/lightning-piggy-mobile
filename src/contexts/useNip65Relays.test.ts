import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNip65Relays } from './useNip65Relays';
import { fetchLatestReplaceable } from '../services/nostrRelayLists';
import * as nostrService from '../services/nostrService';
import { rearmBackgroundDmWatchForActiveIdentity } from '../services/backgroundDmService';

jest.mock('../services/nostrRelayLists', () => ({ fetchLatestReplaceable: jest.fn() }));
jest.mock('../services/backgroundDmService', () => ({
  rearmBackgroundDmWatchForActiveIdentity: jest.fn().mockResolvedValue(undefined),
}));
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

it('a just-published inbox list is not overwritten by an older in-flight load', async () => {
  let finish!: (v: unknown) => void;
  fetchLatest.mockReturnValue(new Promise((r) => (finish = r)));
  const { result } = renderHook(() => useNip65Relays());
  await act(async () => {
    await result.current.loadRelays(PK);
  });
  await act(async () => {
    await result.current.applyPublishedDmInbox(PK, ['wss://nostr.mom']);
  });
  await act(async () => {
    finish(inboxEvent(['wss://old-inbox.example'])); // older copy lands after the publish
  });
  expect(result.current.dmInboxRelays).toEqual(['wss://nostr.mom']);
});

it("looks up the DM inbox list on the user's NIP-65 write relays too", async () => {
  fetchList.mockResolvedValue([
    { url: 'wss://my-write.example', read: false, write: true },
    { url: 'wss://my-read.example', read: true, write: false },
  ]);
  fetchLatest.mockResolvedValue(null);
  const { result } = renderHook(() => useNip65Relays());
  await act(async () => {
    await result.current.loadRelays(PK);
  });
  await waitFor(() => expect(fetchLatest).toHaveBeenCalled());
  const relays = fetchLatest.mock.calls[0][2] as string[];
  expect(relays).toContain('wss://my-write.example');
  expect(relays).not.toContain('wss://my-read.example');
});

it('a NIP-65 load finishing after an in-app publish does not overwrite it', async () => {
  let finish!: (v: unknown) => void;
  fetchList.mockReturnValue(new Promise((r) => (finish = r)));
  fetchLatest.mockResolvedValue(null);
  const { result } = renderHook(() => useNip65Relays());
  let loading!: Promise<unknown>;
  act(() => {
    loading = result.current.loadRelays(PK);
  });
  const published = [{ url: 'wss://nostr.mom', read: true, write: true }];
  await act(async () => {
    await result.current.applyPublishedRelayList(PK, published);
  });
  await act(async () => {
    finish([{ url: 'wss://stale.example', read: true, write: true }]);
    await loading;
  });
  expect(result.current.nip65Relays).toEqual(published);
});

it('a NIP-65 load finishing after an identity reset does not start an inbox load', async () => {
  let finish!: (v: unknown) => void;
  fetchList.mockReturnValue(new Promise((r) => (finish = r)));
  fetchLatest.mockResolvedValue(inboxEvent(['wss://old-account.example']));
  const { result } = renderHook(() => useNip65Relays());
  let loading!: Promise<unknown>;
  act(() => {
    loading = result.current.loadRelays(PK);
  });
  act(() => result.current.resetRelayLists());
  await act(async () => {
    finish([{ url: 'wss://relay.primal.net', read: true, write: true }]);
    await loading;
  });
  expect(fetchLatest).not.toHaveBeenCalled();
  expect(result.current.dmInboxRelays).toEqual([]);
});

it('re-arms the background DM watch when the inbox list changes, not when it is the same', async () => {
  fetchLatest.mockResolvedValue(null);
  const rearm = rearmBackgroundDmWatchForActiveIdentity as jest.Mock;
  const { result } = renderHook(() => useNip65Relays());
  await act(async () => {
    await result.current.applyPublishedDmInbox(PK, ['wss://nostr.mom']);
  });
  expect(rearm).toHaveBeenCalledTimes(1);
  await act(async () => {
    await result.current.applyPublishedDmInbox(PK, ['wss://nostr.mom']);
  });
  expect(rearm).toHaveBeenCalledTimes(1);
});
