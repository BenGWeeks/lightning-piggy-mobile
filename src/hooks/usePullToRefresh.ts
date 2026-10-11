import { useCallback, useEffect, useRef, useState } from 'react';

/** One piece of a page's refresh; must honour `signal` (timeout / unmount). */
export type Refresher = (signal: AbortSignal) => Promise<void>;
/** Adds a refresher; returns its unregister (use as an effect cleanup). */
export type RegisterRefresher = (refresher: Refresher) => () => void;

/** How long the spinner may run before the refresh counts as failed. */
export const PULL_REFRESH_TIMEOUT_MS = 8000;

/**
 * Pull-to-refresh for a page assembled from independent data sources (#1301):
 * each section registers its own {@link Refresher} (so a lazily-mounted
 * section only refreshes once it exists), and one pull runs them all in
 * parallel. `refreshing` stays true until every refresher settles or the
 * timeout fires — then the shared signal is aborted so nothing keeps running,
 * and `onError` is called once if any refresher failed or time ran out.
 */
export function usePullToRefresh(onError: () => void, timeoutMs = PULL_REFRESH_TIMEOUT_MS) {
  const refreshers = useRef(new Set<Refresher>());
  const inFlight = useRef<AbortController | null>(null);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  const [refreshing, setRefreshing] = useState(false);

  // Leaving the page cancels an in-flight refresh (and its error toast).
  useEffect(() => () => inFlight.current?.abort(), []);

  const register = useCallback<RegisterRefresher>((refresher) => {
    refreshers.current.add(refresher);
    return () => {
      refreshers.current.delete(refresher);
    };
  }, []);

  const onRefresh = useCallback(() => {
    if (inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setRefreshing(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('refresh timed out')), timeoutMs);
    });
    const all = Promise.all([...refreshers.current].map((refresh) => refresh(controller.signal)));
    Promise.race([all, timeout])
      .then(
        () => undefined,
        () => {
          if (!controller.signal.aborted) onErrorRef.current();
        },
      )
      .finally(() => {
        clearTimeout(timer);
        controller.abort();
        inFlight.current = null;
        setRefreshing(false);
      });
  }, [timeoutMs]);

  return { refreshing, onRefresh, register };
}

/** Registers `refresher` with a page's {@link usePullToRefresh} while mounted. */
export function useRegisterRefresher(
  register: RegisterRefresher | undefined,
  refresher: Refresher,
): void {
  useEffect(() => register?.(refresher), [register, refresher]);
}
