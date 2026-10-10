import { REVERSE_CLAIM_VBYTES } from './reverseSwapVerify';

/**
 * Miner-fee selection for a reverse-swap claim (#1174).
 *
 * All rates are sat/vB (bdk-rn's `FeeRate.asSatPerVb()`; Electrum's BTC/kB
 * is converted inside BDK). Fees are whole sats.
 *
 * The claim used to pay `ceil(180 vB × max(2, ceil(2-block estimate)))`,
 * which overpaid roughly 3.5× on a quiet network: Core's conservative
 * 2-block estimate, rounded up to a whole sat/vB with a floor of 2, times a
 * size budget ~29% above the real 140 vB claim. Now we use a ~30-minute
 * target, keep the rate fractional, charge the measured vsize, and cap the
 * total at the budget the swap was quoted with.
 */

/** Confirmation target for the live estimate. The claim reveals the
 *  preimage and has ≥ REVERSE_CLAIM_MARGIN blocks before Boltz's refund path
 *  opens, so it does not need next-block priority. */
export const CLAIM_FEE_TARGET_BLOCKS = 3;
/** Bitcoin Core's default minimum relay fee rate. */
export const MIN_CLAIM_FEE_RATE = 1;
/** Legacy default when neither a live estimate nor a quoted rate exists. */
export const FALLBACK_CLAIM_FEE_RATE = 2;
const MAX_SANE_FEE_RATE = 5000;

function isUsableRate(rate: unknown): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 && rate <= MAX_SANE_FEE_RATE;
}

/** sat/vB to build the claim with: the live estimate, else the quoted rate,
 *  else the legacy default. Never below the relay floor. Not rounded. */
export function selectClaimFeeRate(
  liveEstimate: number | null | undefined,
  quotedRate: number | undefined,
): number {
  const rate = isUsableRate(liveEstimate)
    ? liveEstimate
    : isUsableRate(quotedRate)
      ? quotedRate
      : FALLBACK_CLAIM_FEE_RATE;
  return Math.max(MIN_CLAIM_FEE_RATE, rate);
}

/** The claim fee the swap was quoted with (sats), if the quote's rate is known. */
export function claimFeeBudget(quotedRate: number | undefined): number | undefined {
  return isUsableRate(quotedRate) ? Math.ceil(REVERSE_CLAIM_VBYTES * quotedRate) : undefined;
}

/**
 * Absolute claim fee in sats for a transaction of `vsize` vbytes: the rate
 * times the measured size, capped at the quoted budget, but never below
 * the relay floor (a claim that can't relay is worse than a slightly
 * dearer one).
 */
export function claimFeeSats(vsize: number, feeRate: number, budget?: number): number {
  if (!Number.isSafeInteger(vsize) || vsize <= 0) throw new Error(`Invalid claim vsize ${vsize}`);
  if (!Number.isFinite(feeRate)) throw new Error(`Invalid claim fee rate ${feeRate}`);
  const floor = Math.ceil(vsize * MIN_CLAIM_FEE_RATE);
  let fee = Math.ceil(vsize * Math.max(MIN_CLAIM_FEE_RATE, feeRate));
  if (budget !== undefined) fee = Math.min(fee, budget);
  return Math.max(fee, floor);
}
