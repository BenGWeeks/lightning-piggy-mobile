import type { SwapFees } from '../services/boltzService';
import { reverseSwapSendBlocker } from './onchainSwapSend';
import type { DirectShortfall } from './sendFeeEstimate';

export interface SendBlocker {
  key: string;
  params?: Record<string, string>;
}

/** One gate for the button and handler: a known total must fit a known balance. */
export function onchainSendEligibility({
  amountSats,
  balanceSats,
  viaSwap,
  loading,
  fees,
  directFeeSats,
  directShortfall = null,
  errorKey,
}: {
  amountSats: number;
  balanceSats: number | null;
  viaSwap: boolean;
  loading: boolean;
  fees: SwapFees | null;
  directFeeSats: number | null;
  /** BDK couldn't fund the direct send — a balance problem, not a fee one. */
  directShortfall?: DirectShortfall | null;
  errorKey: string | null;
}): { canSend: boolean; reason: SendBlocker | null } {
  let reason: SendBlocker | null = null;
  if (errorKey) {
    reason = { key: errorKey };
  } else if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
    reason = { key: 'sendSheet.enterAmount' };
  } else if (loading) {
    reason = { key: 'sendSheet.loadingFees' };
  } else if (!viaSwap && directShortfall) {
    reason = shortfallBlocker(amountSats, directShortfall, balanceSats);
  } else if (
    viaSwap
      ? !fees
      : directFeeSats === null || !Number.isSafeInteger(directFeeSats) || directFeeSats < 0
  ) {
    reason = { key: viaSwap ? 'swapBackend.quoteFailed' : 'sendSheet.feeUnavailable' };
  } else if (balanceSats === null || !Number.isSafeInteger(balanceSats) || balanceSats < 0) {
    reason = { key: 'sendSheet.balanceUnavailable' };
  } else if (viaSwap && fees) {
    reason = reverseSwapSendBlocker(amountSats, fees, balanceSats);
  } else if (directFeeSats !== null && amountSats + directFeeSats > balanceSats) {
    reason = costsMoreThanBalance(amountSats, directFeeSats, balanceSats);
  }
  return { canSend: reason === null, reason };
}

function costsMoreThanBalance(amount: number, fee: number, balance: number): SendBlocker {
  return {
    key: 'sendSheet.swapInsufficientBalance',
    params: {
      total: (amount + fee).toLocaleString(),
      amount: amount.toLocaleString(),
      fee: fee.toLocaleString(),
      balance: balance.toLocaleString(),
    },
  };
}

/** BDK's "X available of Y needed" (Y = amount + fee) as the balance message. */
function shortfallBlocker(
  amountSats: number,
  { neededSats, availableSats }: DirectShortfall,
  balanceSats: number | null,
): SendBlocker {
  // BDK's spendable total is what this transaction could actually use.
  const balance = availableSats ?? balanceSats;
  if (neededSats !== null && neededSats >= amountSats && balance !== null) {
    return costsMoreThanBalance(amountSats, neededSats - amountSats, balance);
  }
  return { key: 'sendSheet.onchainInsufficientFunds' };
}
