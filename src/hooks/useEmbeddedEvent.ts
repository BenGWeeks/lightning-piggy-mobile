import { useEffect, useMemo, useState } from 'react';
import { useNostr } from '../contexts/NostrContext';
import { DEFAULT_RELAYS } from '../services/nostrService';
import {
  peekEmbed,
  resolveEmbed,
  type EmbedRef,
  type EmbedResult,
} from '../services/nostrEmbedCache';
import { embedKey } from '../utils/nip27';

/**
 * The event behind a NIP-27 `nostr:note…` / `nevent…` / `naddr…` reference,
 * resolved through the batched, cached `nostrEmbedCache`. A cached result
 * paints on the first frame; otherwise `loading` is true until the batch
 * settles (one state update per card).
 */
export function useEmbeddedEvent(ref: EmbedRef): {
  result: EmbedResult | undefined;
  loading: boolean;
} {
  const { relays } = useNostr();
  const key = embedKey(ref);
  const readRelaysKey = useMemo(
    () =>
      relays
        .filter((r) => r.read)
        .map((r) => r.url)
        .join('|'),
    [relays],
  );
  const [state, setState] = useState<{ key: string; result: EmbedResult | undefined }>(() => ({
    key,
    result: peekEmbed(key),
  }));

  useEffect(() => {
    const cached = peekEmbed(key);
    if (cached) {
      setState((prev) =>
        prev.key === key && prev.result === cached ? prev : { key, result: cached },
      );
      return;
    }
    setState({ key, result: undefined });
    let cancelled = false;
    const readRelays = readRelaysKey ? readRelaysKey.split('|') : DEFAULT_RELAYS;
    void resolveEmbed(ref, readRelays).then((result) => {
      if (!cancelled) setState({ key, result });
    });
    return () => {
      cancelled = true;
    };
    // `ref` is identified by `key`; a new object for the same ref is a no-op.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, readRelaysKey]);

  const result = state.key === key ? state.result : undefined;
  return { result, loading: result === undefined };
}
