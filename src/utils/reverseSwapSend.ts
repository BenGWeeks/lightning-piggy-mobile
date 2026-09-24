import * as boltzService from '../services/boltzService';
import {
  payAndClaimReverseSwap,
  persistReverseSwap,
  type PayInvoiceFn,
} from './reverseSwapPayClaim';

export { SwapSettlingError, isSwapSettlingError } from './reverseSwapPayClaim';

export interface ReverseSwapParams {
  walletId: string;
  /** On-chain BTC address the swapped funds are claimed to. */
  destinationAddress: string;
  amountSats: number;
  approvedQuote?: boltzService.SwapFees;
  signal: AbortSignal;
  /** Usually WalletContext's `payInvoiceForWallet`. */
  payInvoice: PayInvoiceFn;
  onReplyTimeout: () => void;
  onPaymentDispatched?: () => void;
}

/**
 * Run a Boltz reverse swap (Lightning → on-chain): create the swap against
 * the approved quote, persist its secrets for crash recovery BEFORE paying,
 * then pay the hold invoice while watching for the lockup and claim as soon
 * as it's verified (see `payAndClaimReverseSwap` for the ordering and the
 * #891 error contract). Swap creation / persistence failures propagate as-is
 * — nothing has been paid yet.
 */
export async function executeReverseSwap(params: ReverseSwapParams): Promise<void> {
  const { walletId, destinationAddress, amountSats, signal, payInvoice, onReplyTimeout } = params;
  const swap = await boltzService.createReverseSwap(
    destinationAddress,
    amountSats,
    params.approvedQuote,
  );
  const persisted = await persistReverseSwap(swap, destinationAddress);
  await payAndClaimReverseSwap({
    persisted,
    walletId,
    payInvoice,
    signal,
    onReplyTimeout,
    onPaymentDispatched: params.onPaymentDispatched,
  });
}
