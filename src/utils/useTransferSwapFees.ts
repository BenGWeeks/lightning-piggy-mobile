import { useEffect, useState } from 'react';
import { getReverseSwapFees, getSubmarineSwapFees, type SwapFees } from '../services/boltzService';

/** Ignore quotes from another direction, hidden sheet, or superseded request. */
export function useTransferSwapFees(direction: string | null, visible: boolean): SwapFees | null {
  const [quote, setQuote] = useState<{ direction: string; fees: SwapFees } | null>(null);
  useEffect(() => {
    setQuote(null);
    if (!visible || (direction !== 'ln-to-onchain' && direction !== 'onchain-to-ln')) return;
    let cancelled = false;
    const request = direction === 'ln-to-onchain' ? getReverseSwapFees : getSubmarineSwapFees;
    request()
      .then((fees) => {
        if (!cancelled) setQuote({ direction, fees });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [direction, visible]);
  return visible && quote?.direction === direction ? quote.fees : null;
}
