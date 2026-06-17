import * as boltzService from '../services/boltzService';
import * as swapRecoveryService from '../services/swapRecoveryService';
import * as SecureStore from 'expo-secure-store';
import { isReplyTimeoutError } from '../services/nwcService';

/**
 * Thrown when the Lightning payment for a reverse swap HAS committed
 * (the sats left the wallet) but the subsequent on-chain lockup/claim
 * failed or is still settling. This is NOT a payment failure:
 * `swapRecoveryService` completes the claim on the next launch, so
 * callers should surface a "still settling / in flight" state rather
 * than "Payment failed" — which would invite a retry and a double-send
 * (#891).
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

export interface ReverseSwapParams {
  walletId: string;
  /** On-chain BTC address the swapped funds are claimed to. */
  destinationAddress: string;
  amountSats: number;
  signal: AbortSignal;
  /** Usually WalletContext's `payInvoiceForWallet`. */
  payInvoice: (
    walletId: string,
    invoice: string,
    opts: { signal: AbortSignal; onReplyTimeout: () => void },
  ) => Promise<unknown>;
  onReplyTimeout: () => void;
}

/**
 * Run a Boltz reverse swap (Lightning → on-chain): create the swap,
 * persist its secrets for crash recovery BEFORE paying, pay the LN
 * invoice, wait for the on-chain lockup, then claim. On success the
 * recovery record is dropped and the claim recorded.
 *
 * Error contract — so the caller can map each outcome to the right
 * overlay state instead of a blanket "Payment failed":
 *   - `ReplyTimeoutError` — rethrown as-is. The wallet's pay reply was
 *     ambiguous; the payment status is UNKNOWN and may have settled.
 *   - `AbortError` — rethrown as-is (user cancelled).
 *   - `SwapSettlingError` — the LN payment committed but the lockup/claim
 *     failed; recovery finishes it on next launch → "still settling".
 *   - `Error('Boltz swap failed: …')` — a genuine pre-commit failure
 *     (the sats did not leave).
 */
export async function executeReverseSwap(params: ReverseSwapParams): Promise<void> {
  const { walletId, destinationAddress, amountSats, signal, payInvoice, onReplyTimeout } = params;

  // Persist the swap secrets to SecureStore *before* paying the LN
  // invoice — swapRecoveryService reads these on the next launch and
  // retries the claim if anything below throws or the app is killed
  // mid-flow. Without persistence the random preimage and claim privkey
  // live in JS memory only, and a failed/aborted claim leaves the
  // on-chain HTLC permanently unspendable (#481).
  const swap = await boltzService.createReverseSwap(destinationAddress, amountSats);
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
    }),
    // Harden the recovery secrets (preimage + claim privkey) the same way
    // the repo guards wallet credentials — device-only, never eligible for
    // iCloud/device-migration backup (walletStorageService). Read-time access
    // is unaffected, so swapRecoveryService still reads this on next launch.
    { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY },
  );
  await swapRecoveryService.registerPendingSwap(swap.id);

  // Once payInvoice resolves the sats have irreversibly left the wallet
  // (LN committed). Track that so the catch can tell a genuine pre-commit
  // failure apart from a slow on-chain settlement that is NOT a payment
  // failure (#891).
  let lnCommitted = false;
  try {
    await payInvoice(walletId, swap.invoice, { signal, onReplyTimeout });
    lnCommitted = true;
    // Give Boltz a generous lockup window (15 min, not 2). On-chain
    // lockups routinely take longer than a couple of minutes, and the old
    // 120 s timeout was a direct trigger for the false "Payment failed"
    // in #891.
    const lockup = await boltzService.waitForLockup(swap.id, 900000);
    const claimTxId = await boltzService.claimSwap(swap, lockup, destinationAddress);
    // Success → drop the recovery record and record the claim so
    // TransactionList can badge the row 'done' and the detail sheet can
    // show the broadcast claim txid.
    await SecureStore.deleteItemAsync(`boltz_swap_${swap.id}`);
    await swapRecoveryService.unregisterPendingSwap(swap.id);
    await swapRecoveryService.recordClaimedFromPreimage(swap.preimage, claimTxId);
    // Tag both legs so the settled LN send + on-chain claim badge as a swap (#895).
    await swapRecoveryService.recordReverseSwapLegs(swap.preimage, claimTxId, swap.id);
  } catch (e) {
    // Leave the persisted record in place so swapRecoveryService can retry
    // on the next launch.
    const detail = e instanceof Error ? e.message || e.toString() : String(e);
    console.warn(`[Boltz] Swap ${swap.id} failed mid-flight, persisted for recovery:`, detail);
    // ReplyTimeoutError keeps its name so the caller routes it to the
    // "still in flight" overlay (ambiguous pay outcome, #891).
    if (isReplyTimeoutError(e)) throw e;
    // User-initiated cancel → caller's AbortError handler (silent close).
    if ((e as Error)?.name === 'AbortError' || signal.aborted) throw e;
    // LN already committed → a slow/failed lockup or claim is a pending
    // on-chain settlement, not a failure. Recovery finishes the claim on
    // next launch; "Payment failed" here would invite a double-send.
    if (lnCommitted) throw new SwapSettlingError(detail);
    throw new Error(`Boltz swap failed: ${detail}`);
  }
}
