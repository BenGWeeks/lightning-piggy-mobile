import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBlossomServerList } from './useBlossomServerList';
import { fetchLatestReplaceable, publishToRelays } from '../services/nostrRelayLists';
import {
  DEFAULT_BLOSSOM_SERVER,
  getBlossomServersUnpublished,
  setBlossomServer,
  setBlossomServers,
} from '../services/walletStorageService';

const PK = 'a'.repeat(64);
const mockSign = jest.fn();
jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({ pubkey: 'a'.repeat(64), relays: [], signEvent: mockSign }),
}));
jest.mock('../services/nostrService', () => ({ DEFAULT_RELAYS: ['wss://default.example'] }));
jest.mock('../services/nostrRelayLists', () => ({
  fetchLatestReplaceable: jest.fn(),
  publishToRelays: jest.fn(),
}));
const fetchLatest = fetchLatestReplaceable as jest.Mock;
const publish = publishToRelays as jest.Mock;
const published = { kind: 10063, created_at: 1, tags: [['server', 'https://remote.example']] };

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  fetchLatest.mockResolvedValue(null);
  mockSign.mockImplementation(async (e: object) => ({ ...e, id: 'i', sig: 's', pubkey: PK }));
});

it("keeps a server the user set before lists existed, and doesn't adopt a published list", async () => {
  await setBlossomServer('https://mine.example');
  fetchLatest.mockResolvedValue(published);
  const { result } = renderHook(() => useBlossomServerList());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.servers).toEqual(['https://mine.example']);
  expect(fetchLatest).not.toHaveBeenCalled();
});

it('adopts a published list on a default device, with editing frozen until it loads', async () => {
  let finish!: (v: unknown) => void;
  fetchLatest.mockReturnValue(new Promise((r) => (finish = r)));
  const { result } = renderHook(() => useBlossomServerList());
  await waitFor(() => expect(result.current.servers).toEqual([DEFAULT_BLOSSOM_SERVER]));
  expect(result.current.editable).toBe(false);
  act(() => {
    result.current.addServer('https://mid-load.example');
  });
  await act(async () => finish(published));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.servers).toEqual(['https://remote.example']);
});

it('remembers unpublished changes across visits, and a successful publish clears them', async () => {
  const first = renderHook(() => useBlossomServerList());
  await waitFor(() => expect(first.result.current.editable).toBe(true));
  act(() => {
    first.result.current.addServer('https://backup.example');
  });
  expect(first.result.current.dirty).toBe(true);
  first.unmount();

  const second = renderHook(() => useBlossomServerList());
  await waitFor(() => expect(second.result.current.editable).toBe(true));
  expect(second.result.current.dirty).toBe(true);
  expect(second.result.current.servers).toEqual([DEFAULT_BLOSSOM_SERVER, 'https://backup.example']);

  publish.mockResolvedValueOnce([{ url: 'wss://default.example', ok: false }]);
  await act(async () => {
    expect(await second.result.current.publish()).toEqual({ ok: false, error: 'none-accepted' });
  });
  expect(second.result.current.dirty).toBe(true);

  publish.mockResolvedValueOnce([{ url: 'wss://default.example', ok: true }]);
  await act(async () => {
    expect((await second.result.current.publish()).ok).toBe(true);
  });
  expect(second.result.current.dirty).toBe(false);
});

it('signs a publish after a future-dated published list', async () => {
  const future = Math.floor(Date.now() / 1000) + 3600;
  const { result } = renderHook(() => useBlossomServerList());
  await waitFor(() => expect(result.current.editable).toBe(true));
  act(() => {
    result.current.addServer('https://backup.example');
  });
  fetchLatest.mockResolvedValue({ ...published, created_at: future });
  publish.mockResolvedValueOnce([{ url: 'wss://default.example', ok: true }]);
  await act(async () => {
    await result.current.publish();
  });
  expect(mockSign.mock.calls.at(-1)[0].created_at).toBeGreaterThan(future);
});

it('keeps "unpublished" when the saved list changed while publishing', async () => {
  const { result } = renderHook(() => useBlossomServerList());
  await waitFor(() => expect(result.current.editable).toBe(true));
  act(() => {
    result.current.addServer('https://backup.example');
  });
  publish.mockImplementationOnce(async () => {
    // Another screen instance edits the list before the relays answer.
    await setBlossomServers([DEFAULT_BLOSSOM_SERVER, 'https://newer.example']);
    return [{ url: 'wss://default.example', ok: true }];
  });
  await act(async () => {
    await result.current.publish();
  });
  expect(await getBlossomServersUnpublished()).toBe(true);
});
