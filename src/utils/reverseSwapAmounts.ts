// Amount maths for a Boltz reverse swap (Lightning → on-chain) where the
// RECIPIENT's on-chain amount is the fixed point and every fee goes on top
// (#1175). Pure — no I/O — so the quote the user approves, the swap we
// create, and the claim we broadcast are all derived from one place.
//
//   recipient N ──(+ our claim fee)──▶ lockup L ──(Boltz fees)──▶ invoice I
//
// - L is what Boltz locks on-chain; we request it as v2 `onchainAmount`.
// - I is the hold invoice the wallet pays: what the user is charged.
// - The claim spends L to the recipient, paying exactly N; the remaining
//   L − N is the claim's miner fee, budgeted at quote time with headroom.
//
// The claim's fee follows the claim itself (swapClaimFee, #1174): the live
// ~30-minute estimate times the claim's measured size. Quotes price it the
// same way so the fees shown are the fees paid.
import type { SwapFees } from '../services/boltzService';
import { MIN_CLAIM_FEE_RATE, claimFeeSats } from './swapClaimFee';

/** Outputs at or below this are non-standard dust; the claim must exceed it. */
export const DUST_SATS = 546;

/**
 * Measured size of our script-path claim paying a 34-byte output script
 * (P2TR / P2WSH) — the largest standard destination; a P2WPKH destination is
 * 140 vB. Quotes use it before the destination's claim can be built.
 */
export const CLAIM_TX_MAX_VSIZE = 152;

/** Whole sat/vB a quote prices the claim at: the live estimate rounded up. */
export function quoteClaimFeeRate(liveEstimate: number): number {
  return Math.max(MIN_CLAIM_FEE_RATE, Math.ceil(liveEstimate));
}

/**
 * Fee rate (sat/vB) to budget an exact-recipient claim at, given the quoted
 * rate. The claim must still pay at least the LIVE rate when it broadcasts
 * minutes later — an under-priced claim can be out-waited by Boltz's refund
 * after our preimage is public — so a small rise (e.g. 1 → 1.5 sat/vB) must
 * not force a short payment. The approved total includes this headroom; any
 * of it the claim doesn't need still goes to miners, never back to Boltz.
 */
export function claimBudgetFeeRate(quotedRate: number): number {
  return Math.max(quotedRate + 1, Math.ceil(quotedRate * 1.25));
}

type ReverseFees = Pick<SwapFees, 'percentage' | 'minerFee' | 'lockupMinerFee' | 'claimFeeRate'>;

export interface ReverseRecipientQuote {
  /** What arrives at the destination address. */
  recipientSats: number;
  /** Miner fee budget for our claim transaction. */
  claimFeeSats: number;
  /** What Boltz must lock on-chain (`onchainAmount`): recipient + claim fee. */
  lockupSats: number;
  /** The Lightning invoice the wallet pays — the total the user is charged. */
  invoiceSats: number;
  /** Everything on top of the recipient amount: invoice − recipient. */
  feeSats: number;
}

/**
 * Hold-invoice amount Boltz charges to lock `lockupSats`. Mirrors
 * boltz-backend `Service.calculateReverseSwapAmounts` (the `onchainAmount`
 * branch; BTC/BTC rate is 1) operation-for-operation so the float rounding
 * matches and the invoice can be verified for an exact amount.
 */
export function reverseInvoiceForLockup(lockupSats: number, fees: ReverseFees): number {
  const holdInvoiceAmount = lockupSats + (fees.lockupMinerFee ?? 0);
  return Math.ceil(holdInvoiceAmount / (1 - fees.percentage / 100));
}

/**
 * Quote a reverse swap that delivers exactly `recipientSats` on-chain. The
 * claim is budgeted at the quoted rate (`fees.claimFeeRate`, else implied by
 * `fees.minerFee`) plus headroom, on the largest standard claim size.
 */
export function quoteExactRecipient(
  recipientSats: number,
  fees: ReverseFees,
): ReverseRecipientQuote {
  const quotedRate = fees.claimFeeRate ?? fees.minerFee / CLAIM_TX_MAX_VSIZE;
  const claimFee = claimFeeSats(CLAIM_TX_MAX_VSIZE, claimBudgetFeeRate(quotedRate));
  const lockupSats = recipientSats + claimFee;
  const invoiceSats = reverseInvoiceForLockup(lockupSats, fees);
  return {
    recipientSats,
    claimFeeSats: claimFee,
    lockupSats,
    invoiceSats,
    feeSats: invoiceSats - recipientSats,
  };
}

/**
 * Recipient amounts a swap can deliver. Boltz enforces its min/max on the
 * INVOICE (what's paid), so both bounds are translated to the recipient
 * side; `budgetSats` (the wallet balance) caps the invoice too, which makes
 * `maxSats` the "send max" amount. Null when nothing fits.
 */
export function reverseRecipientRange(
  fees: ReverseFees & Pick<SwapFees, 'minAmount' | 'maxAmount'>,
  budgetSats?: number | null,
): { minSats: number; maxSats: number } | null {
  const cap = Math.min(fees.maxAmount, budgetSats ?? Infinity);
  const invoiceFor = (n: number) => quoteExactRecipient(n, fees).invoiceSats;
  // The invoice grows monotonically with the recipient amount, so both bounds
  // are binary searches over [dust + 1, cap].
  let lo = DUST_SATS + 1;
  let hi = Math.floor(cap);
  if (hi < lo || invoiceFor(lo) > cap) return null;
  // Largest N with invoice(N) <= cap.
  let maxSats = lo;
  for (let a = lo, b = hi; a <= b; ) {
    const mid = Math.floor((a + b) / 2);
    if (invoiceFor(mid) <= cap) {
      maxSats = mid;
      a = mid + 1;
    } else b = mid - 1;
  }
  // Smallest N with invoice(N) >= the server minimum.
  let minSats = maxSats + 1;
  for (hi = maxSats; lo <= hi; ) {
    const mid = Math.floor((lo + hi) / 2);
    if (invoiceFor(mid) >= fees.minAmount) {
      minSats = mid;
      hi = mid - 1;
    } else lo = mid + 1;
  }
  return minSats <= maxSats ? { minSats, maxSats } : null;
}

export interface ReverseClaimPlan {
  outputSats: number;
  feeSats: number;
  /** True when the claim pays the recipient exactly the quoted amount. */
  exact: boolean;
}

/**
 * Split a verified lockup between the claim output and its miner fee.
 * `requiredFeeSats` is what the claim must pay right now (swapClaimFee on the
 * measured size). An exact-recipient swap pays the recipient precisely when
 * its budgeted remainder covers that, spending the whole remainder as fee.
 * Otherwise — and for legacy invoice-amount swaps — the required fee comes
 * out of the lockup: confirming before Boltz can refund wins over exactness.
 */
export function planReverseClaim(input: {
  lockupSats: number;
  requiredFeeSats: number;
  recipientSats?: number;
}): ReverseClaimPlan {
  const { lockupSats, recipientSats, requiredFeeSats } = input;
  if (
    recipientSats !== undefined &&
    Number.isSafeInteger(recipientSats) &&
    recipientSats > DUST_SATS &&
    recipientSats < lockupSats &&
    lockupSats - recipientSats >= requiredFeeSats
  ) {
    return { outputSats: recipientSats, feeSats: lockupSats - recipientSats, exact: true };
  }
  return { outputSats: lockupSats - requiredFeeSats, feeSats: requiredFeeSats, exact: false };
}
