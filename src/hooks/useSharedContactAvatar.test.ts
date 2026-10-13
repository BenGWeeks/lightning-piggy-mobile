import { renderHook, waitFor } from '@testing-library/react-native';
import { resolveRemoteMedia } from '../services/remoteMediaCache';
import { PREVIEW_IMAGE_MAX_BYTES } from '../utils/remoteUrlPolicy';
import { useSharedContactAvatar } from './useSharedContactAvatar';

jest.mock('../services/remoteMediaCache', () => ({ resolveRemoteMedia: jest.fn() }));
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(resolveRemoteMedia).mockResolvedValue('file:///cache/avatar');
});
it.each(['http://example.com/avatar.jpg', 'https://127.0.0.1/avatar.jpg'])(
  'blocks avatar %s',
  (url) => {
    const { result } = renderHook(() => useSharedContactAvatar(url, true));
    expect(result.current).toBeNull();
    expect(resolveRemoteMedia).not.toHaveBeenCalled();
  },
);
it('preserves sender trust gating', () => {
  renderHook(() => useSharedContactAvatar('https://example.com/avatar.jpg', false));
  expect(resolveRemoteMedia).not.toHaveBeenCalled();
});
it('downloads through bounded transport and supplies only a local URI', async () => {
  const { result } = renderHook(() =>
    useSharedContactAvatar('https://example.com/avatar.jpg', true),
  );
  await waitFor(() => expect(result.current).toBe('file:///cache/avatar'));
  expect(resolveRemoteMedia).toHaveBeenCalledWith(
    'https://example.com/avatar.jpg',
    PREVIEW_IMAGE_MAX_BYTES,
  );
});
