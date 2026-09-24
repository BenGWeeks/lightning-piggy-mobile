import { useCallback, useEffect, useState } from 'react';
import { getReverseSwapFees, getSubmarineSwapFees, type SwapFees } from '../services/boltzService';

/** Ignore quotes/errors from another direction, hidden sheet, or superseded request. */
export function useTransferSwapFees(direction: string | null, visible: boolean) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    direction: string;
    attempt: number;
    fees: SwapFees | null;
    failed: boolean;
  } | null>(null);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const needed = direction === 'ln-to-onchain' || direction === 'onchain-to-ln';
  useEffect(() => {
    setResult(null);
    if (!visible || !needed || !direction) return;
    let cancelled = false;
    const request = direction === 'ln-to-onchain' ? getReverseSwapFees : getSubmarineSwapFees;
    request()
      .then((fees) => {
        if (!cancelled) setResult({ direction, attempt, fees, failed: false });
      })
      .catch(() => {
        if (!cancelled) setResult({ direction, attempt, fees: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [direction, visible, needed, attempt]);
  const current =
    visible && result?.direction === direction && result?.attempt === attempt ? result : null;
  return {
    fees: current?.fees ?? null,
    failed: current?.failed ?? false,
    loading: visible && needed && !current,
    retry,
  };
}
