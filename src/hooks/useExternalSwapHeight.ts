import { useEffect, useState } from 'react';
import { getBlockHeight } from '../services/onchainService';

/** Visible funding instructions stop accepting payment at their timeout block. */
export function useExternalSwapHeight(swapId?: string) {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    setHeight(null);
    if (!swapId) return;
    let active = true;
    const check = async () => {
      try {
        const next = await getBlockHeight();
        if (active) setHeight(next);
      } catch {
        if (active) setHeight(null);
      }
    };
    void check();
    const timer = setInterval(() => void check(), 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [swapId]);
  return height;
}
