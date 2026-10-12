import { useCallback, useEffect, useRef } from 'react';
import type { RefreshDmInboxOptions } from './nostrContextTypes';

export interface DmRefreshFlight {
  promise: Promise<void>;
  /** Resolves after cold-rebuild policy has installed the effective signal. */
  setup: Promise<void>;
  includeNonFollows: boolean;
  force: boolean;
  backfill: boolean;
  signal: AbortSignal;
  /** One automatic request retained until this flight has committed and cleared. */
  reconcile?: () => void;
}

/** Account-scoped reconciliation lifetime, shared by JS/native reconnects and focus. */
export function useDmRefreshCoordinator(owner: string | null) {
  const flights = useRef(new Map<string, DmRefreshFlight>());
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; dispose: () => void } | null>(
    null,
  );
  const cancel = useCallback(() => {
    if (!pending.current) return;
    clearTimeout(pending.current.timer);
    pending.current.dispose();
    pending.current = null;
  }, []);
  useEffect(() => cancel, [owner, cancel]);

  const schedule = useCallback(
    (delay: number, signal: AbortSignal, run: () => void) => {
      if (pending.current || signal.aborted) return;
      const timer = setTimeout(
        () => {
          cancel();
          if (!signal.aborted) run();
        },
        Math.max(0, delay),
      );
      signal.addEventListener('abort', cancel, { once: true });
      pending.current = {
        timer,
        dispose: () => signal.removeEventListener('abort', cancel),
      };
    },
    [cancel],
  );
  return { flights, schedule, cancel };
}

/** Stronger work must follow the existing flight, never inherit its weaker policy. */
export function canJoinDmRefresh(flight: DmRefreshFlight, opts?: RefreshDmInboxOptions): boolean {
  return (
    !flight.signal.aborted &&
    flight.includeNonFollows === (opts?.includeNonFollows === true) &&
    (!opts?.force || flight.force) &&
    (!opts?.backfill || flight.backfill)
  );
}
