import { isConnectionError } from '../services/nwcErrors';

/**
 * True only for payAndClaimReverseSwap's definite pre-commit failure
 * (`Error('Boltz swap failed: …')`): the Lightning payment was rejected and no
 * sats left. Settling / reply-timeout / abort errors, and connection errors
 * (payment outcome unknown, #648) are all false, so their placeholders stay.
 */
export function isReverseSwapNotPaid(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'Error' &&
    error.message.startsWith('Boltz swap failed: ') &&
    !isConnectionError(error)
  );
}

// Sheet copy for a Boltz swap after TransferSheet has handed it off to its
// background task. The amounts must be ones the app actually knows: the
// reverse-swap claim fee is picked at claim time (live fee rate), so the
// on-chain credit is stated as Boltz's locked amount LESS that fee rather than
// the Lightning amount the user typed.

export function reverseSwapClaimingMessage(onchainAmount: number): string {
  return (
    `Boltz locked ${onchainAmount.toLocaleString()} sats on-chain — claiming them to your wallet now.\n\n` +
    "Safe to close — you'll get a notification when the swap completes."
  );
}

export function reverseSwapCompleteMessage(onchainAmount: number, claimTxId: string): string {
  return (
    `Swap complete — ${onchainAmount.toLocaleString()} sats locked by Boltz, less the on-chain claim fee, ` +
    `claimed to your on-chain wallet.\n\nClaim tx ${claimTxId.slice(0, 10)}… is broadcast and ` +
    'will confirm on-chain (~10-60 min).'
  );
}

export function submarineSwapCompleteMessage(invoiceSats: number): string {
  return `Swap complete — ${invoiceSats.toLocaleString()} sats delivered via Lightning.`;
}
