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

// Forward swap (on-chain → Lightning) status lines (#1179). Boltz pays the
// invoice only once the lockup has a confirmation, so the long wait is normal
// block time — say so, rather than leave it looking stuck.
const SAFE_TO_CLOSE = "Safe to close — you'll get a notification when the swap completes.";

export const SUBMARINE_AWAITING_CONFIRMATION_MESSAGE =
  'Waiting for 1 confirmation (~10 min typical). Boltz pays the Lightning invoice once your ' +
  "on-chain transaction is in a block — blocks sometimes take longer, and that's normal.\n\n" +
  SAFE_TO_CLOSE;

export const SUBMARINE_PAYING_MESSAGE =
  'Confirmed on-chain — Boltz is paying the Lightning invoice now.\n\n' + SAFE_TO_CLOSE;
