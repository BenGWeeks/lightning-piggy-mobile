import { fetch as expoFetch } from 'expo/fetch';
import { getInfoAsync, writeAsStringAsync } from 'expo-file-system/legacy';
import { resolveRemoteMedia } from './remoteMediaCache';
import { PREVIEW_IMAGE_MAX_BYTES } from '../utils/remoteUrlPolicy';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  writeAsStringAsync: jest.fn(async () => {}),
}));
const mockFetch = expoFetch as unknown as jest.Mock;
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(getInfoAsync)
    .mockResolvedValue({ exists: false, isDirectory: false } as Awaited<
      ReturnType<typeof getInfoAsync>
    >);
});
it.each(['https://127.0.0.1/a.jpg', 'http://example.com/a.jpg', 'https://example.com:8443/a.jpg'])(
  'never fetches blocked plain media or og:image %s',
  async (url) => {
    await expect(resolveRemoteMedia(url)).rejects.toThrow('Blocked');
    await expect(resolveRemoteMedia(url, PREVIEW_IMAGE_MAX_BYTES)).rejects.toThrow('Blocked');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(writeAsStringAsync).not.toHaveBeenCalled();
  },
);
it('downloads plain media once and supplies a local URI to the renderer', async () => {
  let sent = false;
  mockFetch.mockResolvedValue({
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
  });
  const [a, b] = await Promise.all([
    resolveRemoteMedia('https://example.com/a.jpg'),
    resolveRemoteMedia('https://example.com/a.jpg'),
  ]);
  expect(a).toBe(b);
  expect(a).toMatch(/^file:\/\/\/cache\/remote-/);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(writeAsStringAsync).toHaveBeenCalledWith(a, 'AQID', { encoding: 'base64' });
});
it('rejects oversized preview images without writing or caching them', async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => String(PREVIEW_IMAGE_MAX_BYTES + 1) },
  });
  await expect(
    resolveRemoteMedia('https://example.com/cover.png', PREVIEW_IMAGE_MAX_BYTES),
  ).rejects.toThrow('limit');
  expect(writeAsStringAsync).not.toHaveBeenCalled();
});
