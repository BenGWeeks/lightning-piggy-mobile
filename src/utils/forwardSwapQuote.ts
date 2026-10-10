// Quote for a Boltz submarine swap funded from the user's on-chain wallet
// (Move: on-chain → Lightning). Two parties take a fee: Boltz (percentage +
// its claim miner fee, folded into the lockup amount) and the Bitcoin network
// (the miner fee on OUR lockup transaction). Quoting only Boltz's share
// under-stated the cost by roughly half (#1175). Pure — no I/O.
import { calculateSwapFee, type SwapFees } from '../services/boltzService';

export interface ForwardSwapQuote {
  /** What the Lightning destination receives (the invoice amount). */
  invoiceSats: number;
  /** Boltz's fee, already inside `lockupSats`. */
  boltzFeeSats: number;
  /** What our on-chain transaction sends to Boltz's lockup address. */
  lockupSats: number;
  /** Miner fee for that on-chain transaction; null when it couldn't be priced. */
  networkFeeSats: number | null;
  /** Everything the move costs on top of `invoiceSats` (Boltz's share only
   *  when the network fee is unknown). */
  totalFeeSats: number;
}

/** Boltz's share — known before the on-chain fee can be estimated. */
export function forwardSwapLockup(invoiceSats: number, fees: SwapFees) {
  const boltzFeeSats = calculateSwapFee(invoiceSats, fees);
  return { boltzFeeSats, lockupSats: invoiceSats + boltzFeeSats };
}

export function quoteForwardSwap(
  invoiceSats: number,
  fees: SwapFees,
  networkFeeSats: number | null,
): ForwardSwapQuote {
  const { boltzFeeSats, lockupSats } = forwardSwapLockup(invoiceSats, fees);
  return {
    invoiceSats,
    boltzFeeSats,
    lockupSats,
    networkFeeSats,
    totalFeeSats: boltzFeeSats + (networkFeeSats ?? 0),
  };
}

/** "fee · time" string for the Move sheet's fee row / progress list. An
 *  unpriced network fee is named, never guessed. */
export function formatForwardSwapFee(quote: ForwardSwapQuote): string {
  const n = (v: number) => v.toLocaleString();
  const fee =
    quote.networkFeeSats === null
      ? `~${n(quote.boltzFeeSats)} sats Boltz + network fee`
      : `~${n(quote.totalFeeSats)} sats (Boltz ~${n(quote.boltzFeeSats)} + network ~${n(quote.networkFeeSats)})`;
  return `${fee} · ~10-60 min`;
}
