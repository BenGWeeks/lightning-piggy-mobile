import { isSupportedImageUrl } from '../utils/imageUrl';
import { checkRemoteUrl, PREVIEW_IMAGE_MAX_BYTES } from '../utils/remoteUrlPolicy';
import { useRemoteMediaUri } from './useRemoteMediaUri';

export function useSharedContactAvatar(
  picture: string | null | undefined,
  trusted: boolean,
): string | null {
  const allowed =
    trusted &&
    picture &&
    isSupportedImageUrl(picture) &&
    checkRemoteUrl(picture, { kind: 'media' }).ok;
  return useRemoteMediaUri(allowed ? picture : null, PREVIEW_IMAGE_MAX_BYTES);
}
