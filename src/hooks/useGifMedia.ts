import { checkRemoteUrl, MEDIA_MAX_BYTES } from '../utils/remoteUrlPolicy';
import { useRemoteMediaUri } from './useRemoteMediaUri';
import { useTapToReveal } from './useTapToReveal';

/** GIF consent belongs to this account, message and URL, just like image consent. */
export function useGifMedia(messageId: string, url: string | null, autoLoad: boolean) {
  const safe = url !== null && checkRemoteUrl(url, { kind: 'media' }).ok;
  const [loadAllowed, reveal] = useTapToReveal(`gif:${messageId}:${url}`, autoLoad && safe);
  const uri = useRemoteMediaUri(safe && loadAllowed ? url : null, MEDIA_MAX_BYTES);
  return { uri, loadAllowed, reveal, safe };
}
