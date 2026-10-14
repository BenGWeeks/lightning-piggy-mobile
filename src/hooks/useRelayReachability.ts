import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  probeReachability,
  reachabilityCache,
  reachabilityCacheKey,
  type ReachabilityService,
} from '../services/relayReachabilityProbe';
import type { ProbeResult } from '../utils/relayReachability';

/** One React update per round; blur cancels active transports and queued work. */
export function useRelayReachability(
  urls: readonly string[],
  service: ReachabilityService = 'nostr',
) {
  const sortedUrls = [...new Set(urls)].sort();
  const key = JSON.stringify(sortedUrls);
  const routingKey = JSON.stringify(sortedUrls.map((url) => reachabilityCacheKey(url, service)));
  const [results, setResults] = useState<Map<string, ProbeResult>>(new Map());
  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      const targets: string[] = JSON.parse(key);
      const cacheKeys: string[] = JSON.parse(routingKey);
      let busy = false;
      const round = async (refresh = false) => {
        if (busy) return;
        busy = true;
        const entries = await Promise.all(
          targets.map(async (url, index) => {
            const cacheKey = cacheKeys[index];
            const result =
              (!refresh && reachabilityCache.get(cacheKey)) ||
              (await probeReachability(url, controller.signal, service));
            if (result && !controller.signal.aborted) reachabilityCache.set(cacheKey, result);
            return [url, result] as const;
          }),
        );
        if (!controller.signal.aborted)
          setResults(
            new Map(entries.filter((entry): entry is readonly [string, ProbeResult] => !!entry[1])),
          );
        busy = false;
      };
      setResults(
        new Map(
          targets.flatMap((url, index) => {
            const cached = reachabilityCache.get(cacheKeys[index]);
            return cached ? [[url, cached] as const] : [];
          }),
        ),
      );
      void round();
      const timer = setInterval(() => void round(true), 30_000);
      return () => {
        clearInterval(timer);
        controller.abort();
      };
    }, [key, service, routingKey]),
  );
  return results;
}
