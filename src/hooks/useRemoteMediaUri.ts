import { useEffect, useState } from 'react';
import { resolveRemoteMedia } from '../services/remoteMediaCache';

export function useRemoteMediaUri(url: string | null, maxBytes: number): string | null {
  const [resolved, setResolved] = useState<{ url: string; uri: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (url)
      void resolveRemoteMedia(url, maxBytes)
        .then((uri) => {
          if (!cancelled) setResolved({ url, uri });
        })
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [url, maxBytes]);
  return resolved?.url === url ? resolved.uri : null;
}
