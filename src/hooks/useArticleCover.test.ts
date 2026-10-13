import { renderHook, waitFor } from '@testing-library/react-native';
import { resolveRemoteMedia } from '../services/remoteMediaCache';
import { PREVIEW_IMAGE_MAX_BYTES } from '../utils/remoteUrlPolicy';
import { useArticleCover } from './useArticleCover';

jest.mock('../services/remoteMediaCache', () => ({ resolveRemoteMedia: jest.fn() }));
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(resolveRemoteMedia).mockResolvedValue('file:///cache/cover');
});
it.each(['http://example.com/cover.jpg', 'https://127.0.0.1/cover.jpg'])(
  'blocks cover %s',
  (url) => {
    const { result } = renderHook(() => useArticleCover(url, true));
    expect(result.current).toBeNull();
    expect(resolveRemoteMedia).not.toHaveBeenCalled();
  },
);
it('preserves sender trust gating', () => {
  renderHook(() => useArticleCover('https://example.com/cover.jpg', false));
  expect(resolveRemoteMedia).not.toHaveBeenCalled();
});
it('downloads through bounded transport and supplies only a local URI', async () => {
  const { result } = renderHook(() => useArticleCover('https://example.com/cover.jpg', true));
  await waitFor(() => expect(result.current).toBe('file:///cache/cover'));
  expect(resolveRemoteMedia).toHaveBeenCalledWith(
    'https://example.com/cover.jpg',
    PREVIEW_IMAGE_MAX_BYTES,
  );
});
