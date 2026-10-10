import { useEffect, useState } from 'react';
import * as boltzService from '../services/boltzService';
import * as onchainService from '../services/onchainService';
import {
  formatForwardSwapFee,
  forwardSwapLockup,
  quoteForwardSwap,
} from '../utils/forwardSwapQuote';

/**
 * The Move sheet's "fee · time" estimate for the chosen route and amount.
 * The on-chain → Lightning route adds the miner fee of the user's own lockup
 * transaction (a BDK dry-run of the actual send) to Boltz's fee, so the quote
 * is the true total (#1175). Extracted from TransferSheet (over the size cap).
 */
export function useTransferFeeEstimate(opts: {
  transferType: string | null;
  currentSats: number;
  swapFees: boltzService.SwapFees | null;
  sourceId: string | null;
}): string | null {
  const { transferType, currentSats, swapFees, sourceId } = opts;
  const [estimate, setEstimate] = useState<string | null>(null);

  useEffect(() => {
    setEstimate(null);
    if (!transferType || currentSats <= 0) return;
    let cancelled = false;
    const settle = (value: string) => {
      if (!cancelled) setEstimate(value);
    };
    if (transferType === 'ln-to-ln') {
      settle('~0 sats · Instant (Lightning)');
    } else if (transferType === 'ln-to-onchain' && swapFees) {
      const fee = boltzService.calculateSwapFee(currentSats, swapFees);
      settle(`~${fee.toLocaleString()} sats · ~10-60 min`);
    } else if (transferType === 'onchain-to-ln' && swapFees && sourceId) {
      const { lockupSats } = forwardSwapLockup(currentSats, swapFees);
      onchainService
        .estimateSendFee(sourceId, lockupSats)
        .then((networkFee) =>
          settle(formatForwardSwapFee(quoteForwardSwap(currentSats, swapFees, networkFee))),
        )
        .catch(() => settle('Fee estimate unavailable'));
    } else if (transferType === 'onchain-to-onchain') {
      onchainService
        .estimateOnchainFee()
        .then((fees) => settle(`~${fees.medium.toLocaleString()} sats · ~10-60 min`))
        .catch(() => settle('Fee estimate unavailable'));
    }
    return () => {
      cancelled = true;
    };
  }, [transferType, currentSats, swapFees, sourceId]);

  return estimate;
}
