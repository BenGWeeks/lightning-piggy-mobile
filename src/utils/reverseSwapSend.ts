import * as boltzService from '../services/boltzService';
import {
  payAndClaimReverseSwap,
  persistReverseSwap,
  type PayInvoiceFn,
  type ReverseSwapStage,
} from './reverseSwapPayClaim';

/** Every stage of a Send-screen reverse swap, in order: create the swap, then
 *  `payAndClaimReverseSwap`'s pay+lockup → claim → cleanup. */
export type ReverseSwapSendStage = 'createSwap' | ReverseSwapStage;

export { SwapSettlingError, isSwapSettlingError } from './reverseSwapPayClaim';

export interface ReverseSwapParams {
  walletId: string;
  /** On-chain BTC address the swapped funds are claimed to. */
  destinationAddress: string;
  /** Exactly what the destination receives; every fee is paid on top (#1175). */
  recipientSats: number;
  approvedQuote?: boltzService.SwapFees;
  signal: AbortSignal;
  /** Usually WalletContext's `payInvoiceForWallet`. */
  payInvoice: PayInvoiceFn;
  onReplyTimeout: () => void;
  onPaymentDispatched?: () => void;
  onStage?: (stage: ReverseSwapSendStage) => void;
}

/** What a completed send delivered and what it cost. */
export interface ReverseSwapReceipt {
  claimTxId: string;
  /** What the claim paid the destination. */
  recipientSats: number;
  /** The Lightning invoice the wallet paid (excluding any routing fee). */
  paidSats: number;
}

/**
 * Run a Boltz reverse swap (Lightning → on-chain): create the swap against
 * the approved quote, persist its secrets for crash recovery BEFORE paying,
 * then pay the hold invoice while watching for the lockup and claim as soon
 * as it's verified (see `payAndClaimReverseSwap` for the ordering and the
 * #891 error contract). Swap creation / persistence failures propagate as-is
 * — nothing has been paid yet.
 */
export async function executeReverseSwap(params: ReverseSwapParams): Promise<ReverseSwapReceipt> {
  const { walletId, destinationAddress, recipientSats, signal, payInvoice, onReplyTimeout } =
    params;
  params.onStage?.('createSwap');
  const swap = await boltzService.createReverseSwap(
    destinationAddress,
    recipientSats,
    params.approvedQuote,
    'recipient',
  );
  const persisted = await persistReverseSwap(swap, destinationAddress);
  const claim = await payAndClaimReverseSwap({
    persisted,
    walletId,
    payInvoice,
    signal,
    onReplyTimeout,
    onPaymentDispatched: params.onPaymentDispatched,
    onStage: params.onStage,
  });
  return {
    claimTxId: claim.txId,
    recipientSats: claim.outputSats,
    paidSats: swap.invoiceAmount ?? 0,
  };
}
