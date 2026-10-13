import { act, renderHook, waitFor } from '@testing-library/react-native';
import { fetch as expoFetch } from 'expo/fetch';
import { __resetForTests } from '../services/mediaRevealStore';
import { useGifMedia } from './useGifMedia';

jest.mock('./useActivePubkey', () => ({ useActivePubkey: () => 'reader' }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  writeAsStringAsync: jest.fn(async () => {}),
}));

const mockFetch = expoFetch as unknown as jest.Mock;
const url = 'https://example.com/animation.gif';
beforeEach(() => {
  jest.clearAllMocks();
  __resetForTests();
  mockFetch.mockImplementation(async () => {
    let sent = false;
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: async () => {
            if (sent) return { done: true };
            sent = true;
            return { done: false, value: new Uint8Array([1, 2, 3]) };
          },
          cancel: async () => {},
          releaseLock: () => {},
        }),
      },
    };
  });
});

it('makes no request for an unfollowed sender until tap-to-reveal consent', async () => {
  const { result } = renderHook(() => useGifMedia('message', url, false));
  await act(async () => {});
  expect(mockFetch).not.toHaveBeenCalled();
  expect(result.current.loadAllowed).toBe(false);
  expect(result.current.uri).toBeNull();

  act(() => result.current.reveal());
  await waitFor(() => expect(result.current.uri).toMatch(/^file:\/\/\/cache\/remote-/));
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('automatically loads a trusted sender GIF', async () => {
  const { result } = renderHook(() => useGifMedia('message', url, true));
  await waitFor(() => expect(result.current.uri).not.toBeNull());
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('requires fresh consent when a recycled message or edited URL changes', async () => {
  const { result, rerender } = renderHook(
    ({ id, mediaUrl }: { id: string; mediaUrl: string }) => useGifMedia(id, mediaUrl, false),
    { initialProps: { id: 'message', mediaUrl: url } },
  );
  act(() => result.current.reveal());
  await waitFor(() => expect(result.current.uri).not.toBeNull());
  rerender({ id: 'another-message', mediaUrl: url });
  await act(async () => {});
  expect(result.current.loadAllowed).toBe(false);
  expect(result.current.uri).toBeNull();
  rerender({ id: 'message', mediaUrl: 'https://example.com/edited.gif' });
  await act(async () => {});
  expect(result.current.loadAllowed).toBe(false);
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('never requests a blocked GIF even after consent or with a trusted sender', async () => {
  const { result } = renderHook(() => useGifMedia('message', 'https://127.0.0.1/a.gif', true));
  act(() => result.current.reveal());
  await act(async () => {});
  expect(result.current.safe).toBe(false);
  expect(result.current.uri).toBeNull();
  expect(mockFetch).not.toHaveBeenCalled();
});
