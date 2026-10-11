import { useCallback, useEffect, useRef, useState } from 'react';
import { getSubmarineSwapFees, type SwapFees } from '../services/boltzService';
import { swapQuoteErrorKey } from '../services/swapBackendService';

export type ReceiveFeeResult = { fees: SwapFees } | { errorKey: string } | { stale: true };

/**
 * The swap-in (on-chain → Lightning) fee schedule for one Receive session:
 * fetched when the sheet opens, and fetched again by `ensureFees` when the
 * user confirms an amount without one, so a failed first quote (offline,
 * server down) recovers instead of replaying the cached error. Errors are i18n
 * keys, never raw server text. Results from a closed/reopened session are
 * dropped (`stale`).
 */
export function useReceiveSwapFees(visible: boolean) {
  const [fees, setFees] = useState<SwapFees | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const session = useRef(0);
  const feesRef = useRef(fees);
  feesRef.current = fees;

  const load = useCallback(async (): Promise<ReceiveFeeResult> => {
    const mine = session.current;
    setErrorKey(null);
    try {
      const next = await getSubmarineSwapFees();
      if (session.current !== mine) return { stale: true };
      setFees(next);
      return { fees: next };
    } catch (error) {
      if (session.current !== mine) return { stale: true };
      const key = swapQuoteErrorKey(error);
      setErrorKey(key);
      return { errorKey: key };
    }
  }, []);

  useEffect(() => {
    session.current += 1;
    // A prior session's schedule must not leak into this one's min/max.
    setFees(null);
    setErrorKey(null);
    if (visible) void load();
  }, [visible, load]);

  /** The current schedule, or a fresh fetch when there isn't one yet. */
  const ensureFees = useCallback(
    (): Promise<ReceiveFeeResult> =>
      feesRef.current ? Promise.resolve({ fees: feesRef.current }) : load(),
    [load],
  );

  return { fees, errorKey, ensureFees, adopt: setFees };
}
