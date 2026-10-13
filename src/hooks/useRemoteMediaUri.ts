import { useEffect, useState } from 'react';
import { useActivePubkey } from './useActivePubkey';
import { resolveRemoteMedia } from '../services/remoteMediaCache';

export function useRemoteMediaUri(url: string | null, maxBytes: number): string | null {
  const owner = useActivePubkey();
  const [resolved, setResolved] = useState<{
    owner: string | null;
    url: string;
    uri: string;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (url)
      void resolveRemoteMedia(url, maxBytes)
        .then((uri) => {
          if (!cancelled) setResolved({ owner, url, uri });
        })
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [owner, url, maxBytes]);
  return resolved?.owner === owner && resolved?.url === url ? resolved.uri : null;
}
