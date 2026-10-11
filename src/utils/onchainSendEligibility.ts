import type { SwapFees } from '../services/boltzService';
import { reverseSwapSendBlocker } from './onchainSwapSend';

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
  errorKey,
}: {
  amountSats: number;
  balanceSats: number | null;
  viaSwap: boolean;
  loading: boolean;
  fees: SwapFees | null;
  directFeeSats: number | null;
  errorKey: string | null;
}): { canSend: boolean; reason: SendBlocker | null } {
  let reason: SendBlocker | null = null;
  if (errorKey) {
    reason = { key: errorKey };
  } else if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
    reason = { key: 'sendSheet.enterAmount' };
  } else if (loading) {
    reason = { key: 'sendSheet.loadingFees' };
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
    reason = {
      key: 'sendSheet.swapInsufficientBalance',
      params: {
        total: (amountSats + directFeeSats).toLocaleString(),
        amount: amountSats.toLocaleString(),
        fee: directFeeSats.toLocaleString(),
        balance: balanceSats.toLocaleString(),
      },
    };
  }
  return { canSend: reason === null, reason };
}
