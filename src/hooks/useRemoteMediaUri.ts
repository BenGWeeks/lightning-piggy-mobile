import { useCallback, useEffect, useState } from 'react';
import { useActivePubkey } from './useActivePubkey';
import { resolveRemoteMedia } from '../services/remoteMediaCache';

export function useRemoteMedia(url: string | null, maxBytes: number) {
  const owner = useActivePubkey();
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const [resolved, setResolved] = useState<{
    owner: string | null;
    url: string;
    maxBytes: number;
    uri: string | null;
    failed: boolean;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setResolved(null);
    if (url)
      void resolveRemoteMedia(url, maxBytes).then(
        (uri) => {
          if (!cancelled) setResolved({ owner, url, maxBytes, uri, failed: false });
        },
        () => {
          if (!cancelled) setResolved({ owner, url, maxBytes, uri: null, failed: true });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [owner, url, maxBytes, attempt]);
  const current =
    resolved?.owner === owner && resolved?.url === url && resolved?.maxBytes === maxBytes;
  return { uri: current ? resolved.uri : null, failed: current && resolved.failed, retry };
}

/** URI-only convenience for renderers without a retry control. */
export function useRemoteMediaUri(url: string | null, maxBytes: number): string | null {
  return useRemoteMedia(url, maxBytes).uri;
}
