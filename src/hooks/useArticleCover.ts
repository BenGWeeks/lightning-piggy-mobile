import { useRemoteMediaUri } from './useRemoteMediaUri';
import { checkRemoteUrl, PREVIEW_IMAGE_MAX_BYTES } from '../utils/remoteUrlPolicy';

/** Article covers obey sender trust and the bounded, account-scoped transport. */
export function useArticleCover(url: string | undefined, trusted: boolean): string | null {
  const allowed = trusted && !!url && checkRemoteUrl(url, { kind: 'media' }).ok;
  return useRemoteMediaUri(allowed ? url : null, PREVIEW_IMAGE_MAX_BYTES);
}
