import * as SecureStore from 'expo-secure-store';
import * as boltzService from '../services/boltzService';
import * as swapRecoveryService from '../services/swapRecoveryService';
import { createAbortError, isReplyTimeoutError } from '../services/nwcErrors';

/**
 * Thrown when the Lightning side of a reverse swap HAS committed (the payment
 * completed, or Boltz locked up against our in-flight HTLC) but the on-chain
 * lockup/claim failed or is still settling. This is NOT a payment failure:
 * `swapRecoveryService` completes the claim from the persisted record, so
 * callers should surface a "still settling / in flight" state rather than
 * "Payment failed" — which would invite a retry and a double-send (#891).
 */
export class SwapSettlingError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'SwapSettlingError';
  }
}

export function isSwapSettlingError(error: unknown): boolean {
  return (error as Error)?.name === 'SwapSettlingError';
}

/** Usually WalletContext's `payInvoiceForWallet`. */
export type PayInvoiceFn = (
  walletId: string,
  invoice: string,
  opts: { signal: AbortSignal; onReplyTimeout: () => void },
) => Promise<unknown>;

// Give Boltz a generous lockup window (15 min, not 2). On-chain lockups
// routinely take longer than a couple of minutes, and the old 120 s timeout
// was a direct trigger for the false "Payment failed" in #891.
export const REVERSE_LOCKUP_TIMEOUT_MS = 900_000;
// After the claim broadcasts, Boltz settles the hold invoice within seconds.
// Wait briefly so the caller's post-send refresh sees the settled LN leg, but
// never let a slow wallet reply hold a completed swap hostage.
export const PAYMENT_SETTLE_GRACE_MS = 10_000;

declare const persistedBrand: unique symbol;
/** Only obtainable from `persistReverseSwap`, so the payment can't start
 *  before the recovery record and index are durable. */
export interface PersistedReverseSwap {
  readonly swap: boltzService.ReverseSwapResult;
  readonly destinationAddress: string;
  readonly [persistedBrand]: true;
}

/**
 * Persist the swap secrets and register them in the recovery index. Must
 * complete BEFORE paying: swapRecoveryService reads these on the next launch
 * and retries the claim if the live flow throws or the app is killed. Without
 * them the random preimage and claim privkey live in JS memory only, and a
 * failed claim leaves the on-chain HTLC permanently unspendable (#481).
 */
export async function persistReverseSwap(
  swap: boltzService.ReverseSwapResult,
  destinationAddress: string,
): Promise<PersistedReverseSwap> {
  await SecureStore.setItemAsync(
    `boltz_swap_${swap.id}`,
    JSON.stringify({
      id: swap.id,
      preimage: swap.preimage,
      claimPrivateKey: swap.claimPrivateKey,
      lockupAddress: swap.lockupAddress,
      destinationAddress,
      refundPublicKey: swap.refundPublicKey,
      swapTree: swap.swapTree,
      onchainAmount: swap.onchainAmount,
      timeoutBlockHeight: swap.timeoutBlockHeight,
      claimFeeRate: swap.claimFeeRate,
    }),
    // Harden the recovery secrets (preimage + claim privkey) the same way
    // the repo guards wallet credentials — device-only, never eligible for
    // iCloud/device-migration backup (walletStorageService). Read-time access
    // is unaffected, so swapRecoveryService still reads this on next launch.
    { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY },
  );
  await swapRecoveryService.registerPendingSwap(swap.id);
  return { swap, destinationAddress } as PersistedReverseSwap;
}

export type ReverseSwapStage = 'payAndLockup' | 'claimSwap' | 'cleanup';

export interface PayAndClaimParams {
  persisted: PersistedReverseSwap;
  walletId: string;
  payInvoice: PayInvoiceFn;
  signal?: AbortSignal;
  onReplyTimeout?: () => void;
  onPaymentDispatched?: () => void;
  onStage?: (stage: ReverseSwapStage) => void;
  paymentSettleGraceMs?: number;
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

// Observe a promise's outcome without ever producing an unhandled rejection,
// including when `start` throws synchronously.
function settle<T>(start: () => Promise<T>): Promise<Settled<T>> {
  return new Promise<T>((resolve) => resolve(start())).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

const detailOf = (e: unknown) => (e instanceof Error ? e.message || e.toString() : String(e));

/**
 * Pay a persisted reverse swap's hold invoice and claim the on-chain lockup.
 *
 * Boltz's invoice is a HOLD invoice: it only settles after our claim reveals
 * the preimage on-chain. So the payment and the lockup watch run
 * concurrently, and we claim as soon as a verified lockup appears — awaiting
 * the payment first would deadlock until the wallet's reply timeout and
 * leave the claim to recovery. The preimage is only disclosed inside
 * `claimSwap`, which runs only with a lockup `waitForLockup` verified against
 * the swap's address and amount (and re-verifies it). `payInvoice` is called
 * exactly once; nothing here retries a payment.
 *
 * Resolves with the claim txid. Error contract — so the caller can map each
 * outcome to the right overlay state instead of a blanket "Payment failed":
 *   - `ReplyTimeoutError` — rethrown as-is. The wallet's pay reply was
 *     ambiguous; the payment status is UNKNOWN and may have settled.
 *   - `AbortError` — only before payment dispatch; later cancellation is ambiguous.
 *   - `SwapSettlingError` — the LN side committed but the lockup/claim
 *     failed; recovery finishes it → "still settling".
 *   - `Error('Boltz swap failed: …')` — a genuine pre-commit failure
 *     (the sats did not leave).
 * The recovery record is kept on every failure and dropped on success.
 */
export async function payAndClaimReverseSwap(params: PayAndClaimParams): Promise<string> {
  const { swap, destinationAddress } = params.persisted;
  const { signal } = params;
  // Pre-commit cancel: don't dispatch the payment or start a lockup watch.
  if (signal?.aborted) throw createAbortError();

  // Our own controller so we can stop the wallet's reply polling once the
  // outcome no longer matters, while still forwarding the caller's cancel.
  const payCtrl = new AbortController();
  const forwardAbort = () => payCtrl.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  let finished = false;

  const lockupWait = settle(() =>
    boltzService.waitForLockup(swap, REVERSE_LOCKUP_TIMEOUT_MS, payCtrl.signal),
  );
  params.onPaymentDispatched?.();
  const payment = settle(() =>
    params.payInvoice(params.walletId, swap.invoice, {
      signal: payCtrl.signal,
      // A late reply timeout must not repaint a caller that has moved on.
      onReplyTimeout: () => {
        if (!finished) params.onReplyTimeout?.();
      },
    }),
  );

  const preCommitError = (e: unknown) => {
    // ReplyTimeoutError keeps its name so the caller routes it to the
    // "still in flight" overlay (ambiguous pay outcome, #891).
    if (isReplyTimeoutError(e)) return e;
    // Once dispatched, aborting the reply cannot recall a held HTLC. Keep
    // recovery and show an in-flight outcome rather than inviting a retry.
    if ((e as Error)?.name === 'AbortError' || signal?.aborted)
      return new SwapSettlingError('Payment may still settle; the saved swap will be recovered.');
    return new Error(`Boltz swap failed: ${detailOf(e)}`);
  };

  // Once committed, NEVER surface a failure as pre-commit — even a user
  // cancel during lockup/claim must read as "still settling", or we
  // reintroduce the #891 double-send risk.
  let committed = false;
  try {
    params.onStage?.('payAndLockup');
    const first = await Promise.race([
      payment.then((r) => ({ payment: r })),
      lockupWait.then((r) => ({ lockup: r })),
    ]);
    let lockup: Settled<Awaited<ReturnType<typeof boltzService.waitForLockup>>>;
    if ('payment' in first) {
      // The payment resolved before any lockup was seen. A failure here means
      // Boltz never locked up for us; a success means the sats have left.
      if (!first.payment.ok) throw preCommitError(first.payment.error);
      committed = true;
      lockup = await lockupWait;
    } else {
      lockup = first.lockup;
    }
    if (!lockup.ok) {
      // No verified lockup: the payment's own outcome decides whether the
      // sats left. It is bounded by the wallet's reply timeout.
      if (!committed) {
        const paid = await payment;
        if (!paid.ok) throw preCommitError(paid.error);
        committed = true;
      }
      throw lockup.error;
    }

    // A verified lockup means Boltz accepted our HTLC — committed, whatever
    // the wallet has (or hasn't yet) replied. Claiming reveals the preimage,
    // which is what lets Boltz settle the hold invoice.
    committed = true;
    params.onStage?.('claimSwap');
    const claimTxId = await boltzService.claimSwap(swap, lockup.value, destinationAddress);
    // Success → drop the recovery record and record the claim so
    // TransactionList can badge the row 'done' and the detail sheet can
    // show the broadcast claim txid.
    params.onStage?.('cleanup');
    await SecureStore.deleteItemAsync(`boltz_swap_${swap.id}`);
    await swapRecoveryService.unregisterPendingSwap(swap.id);
    await swapRecoveryService.recordClaimedFromPreimage(swap.preimage, claimTxId);
    // Tag both legs so the settled LN send + on-chain claim badge as a swap (#895).
    await swapRecoveryService.recordReverseSwapLegs(swap.preimage, claimTxId, swap.id);

    await awaitPaymentSettle(
      payment,
      params.paymentSettleGraceMs ?? PAYMENT_SETTLE_GRACE_MS,
      swap.id,
    );
    return claimTxId;
  } catch (e) {
    // Leave the persisted record in place so swapRecoveryService can retry.
    const detail = detailOf(e);
    console.warn(`[Boltz] Swap ${swap.id} failed mid-flight, persisted for recovery:`, detail);
    if (committed) throw new SwapSettlingError(detail);
    throw e;
  } finally {
    finished = true;
    signal?.removeEventListener('abort', forwardAbort);
    // Stops the wallet's reply polling if it's still running; the payment
    // itself cannot be recalled, and its outcome is already observed.
    payCtrl.abort();
  }
}

// The claim is on-chain, so the swap succeeded whatever the wallet reports
// next. Give the hold invoice a short window to settle, then detach.
async function awaitPaymentSettle(
  payment: Promise<Settled<unknown>>,
  graceMs: number,
  swapId: string,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    payment,
    new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), graceMs);
    }),
  ]);
  clearTimeout(timer);
  if (!outcome) {
    console.warn(`[Boltz] Swap ${swapId} claimed; LN payment still settling`);
  } else if (!outcome.ok) {
    console.warn(`[Boltz] Swap ${swapId} claimed; LN payment reported: ${detailOf(outcome.error)}`);
  }
}
