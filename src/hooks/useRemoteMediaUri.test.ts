import { act, renderHook, waitFor } from '@testing-library/react-native';
import { resolveRemoteMedia } from '../services/remoteMediaCache';
import { useRemoteMedia } from './useRemoteMediaUri';
import { MEDIA_MAX_BYTES } from '../utils/remoteUrlPolicy';

let mockOwner = 'alice';
jest.mock('./useActivePubkey', () => ({ useActivePubkey: () => mockOwner }));
jest.mock('../services/remoteMediaCache', () => ({ resolveRemoteMedia: jest.fn() }));
const url = 'https://example.com/voice.mp3';
beforeEach(() => {
  jest.clearAllMocks();
  mockOwner = 'alice';
});
it('retries a failed plain voice download without changing the URL or consent', async () => {
  jest
    .mocked(resolveRemoteMedia)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce('file:///alice/voice');
  const { result } = renderHook(() => useRemoteMedia(url, MEDIA_MAX_BYTES));
  await waitFor(() => expect(result.current.failed).toBe(true));
  expect(result.current.uri).toBeNull();
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.uri).toBe('file:///alice/voice'));
  expect(result.current.failed).toBe(false);
  expect(resolveRemoteMedia).toHaveBeenCalledTimes(2);
  expect(resolveRemoteMedia).toHaveBeenLastCalledWith(url, MEDIA_MAX_BYTES);
});
it('clears failure on account change and ignores a late previous-account result', async () => {
  let finish!: (uri: string) => void;
  jest
    .mocked(resolveRemoteMedia)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error('offline'));
  const { result, rerender } = renderHook(() => useRemoteMedia(url, MEDIA_MAX_BYTES));
  mockOwner = 'bob';
  rerender({});
  await waitFor(() => expect(result.current.failed).toBe(true));
  await act(async () => finish('file:///alice/voice'));
  expect(result.current.uri).toBeNull();
  mockOwner = 'carol';
  jest.mocked(resolveRemoteMedia).mockResolvedValueOnce('file:///carol/voice');
  rerender({});
  expect(result.current.failed).toBe(false);
  await waitFor(() => expect(result.current.uri).toBe('file:///carol/voice'));
});
it('does not download or retry before consent', async () => {
  const { result } = renderHook(() => useRemoteMedia(null, MEDIA_MAX_BYTES));
  act(() => result.current.retry());
  await act(async () => {});
  expect(resolveRemoteMedia).not.toHaveBeenCalled();
});
