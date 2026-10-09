/**
 * When does Boltz's own status PROVE a reverse swap's hold invoice can never
 * settle — i.e. that nothing was sent? (#1167)
 *
 * Boltz reverse swaps have no status between "invoice paid" and "lockup
 * broadcast": the swap reads `swap.created` both before our HTLC arrives AND
 * while Boltz holds it and prepares its lockup (which #891 showed can lag by
 * minutes). So `swap.created` is NOT proof the payment failed, and a
 * reply-lost / ambiguous wallet outcome must keep routing to "still in
 * flight" while the swap is in that state.
 *
 * Only these terminal statuses prove the hold invoice will never settle (per
 * Boltz's reverse-swap lifecycle): the invoice expired and pending HTLCs
 * were cancelled, the swap expired unpaid, Boltz failed to lock up and
 * cancelled the HTLC, or Boltz refunded its own lockup (which also cancels
 * the HTLC). In every case the Lightning funds bounce back to the payer.
 * swapRecoveryService already retires the recovery record on exactly these
 * statuses, so the live flow doing the same keeps the two consistent.
 */
const NEVER_SETTLES = new Set([
  'invoice.expired',
  'swap.expired',
  'transaction.failed',
  'transaction.refunded',
]);

export function isReverseSwapNeverSettlesStatus(status: unknown): status is string {
  return typeof status === 'string' && NEVER_SETTLES.has(status);
}

// `waitForLockup` rejects with `Swap failed with status: <status>` on an
// explicit Boltz fail status (see boltzService.isExplicitSwapFailure).
const EXPLICIT_FAILURE_PREFIX = 'Swap failed with status: ';

/** The never-settles status carried by a `waitForLockup` rejection, if any. */
export function neverSettlesStatusFromLockupError(error: unknown): string | null {
  const msg = error instanceof Error ? error.message : '';
  if (!msg.startsWith(EXPLICIT_FAILURE_PREFIX)) return null;
  const status = msg.slice(EXPLICIT_FAILURE_PREFIX.length).trim();
  return isReverseSwapNeverSettlesStatus(status) ? status : null;
}

/**
 * The definite pre-commit failure for a swap Boltz never got paid. Uses the
 * same `Boltz swap failed: ` shape as a wallet-rejected payment so every
 * caller's `isReverseSwapNotPaid` check treats it as "nothing was sent".
 */
export function createSwapNotPaidError(status: string): Error {
  return new Error(
    `Boltz swap failed: Boltz reports ${status}; the Lightning payment never settled, nothing was sent`,
  );
}
