import { useCallback, useLayoutEffect, useRef } from 'react';
import type { Bbox } from '../services/btcMapService';

/** Coalesce camera updates and prevent delayed work from outliving the map. */
export function useDebouncedMapBounds(onSettled: (bounds: Bbox) => void) {
  const callback = useRef(onSettled);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    callback.current = onSettled;
  }, [onSettled]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, []);
  return useCallback((bounds: Bbox) => {
    if (!mounted.current) return;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (mounted.current) callback.current(bounds);
    }, 500);
  }, []);
}
