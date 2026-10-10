/**
 * Broadcasting Boltz claim/refund transactions robustly against the
 * propagation gap between Boltz's lockup and our chain backend (#481, #1174).
 *
 * When `waitForLockup` returns at `transaction.mempool`, Boltz broadcast the
 * lockup moments ago and our Electrum server may not have it yet, so a
 * claim spending it is rejected as "missing inputs". On 2026-10-10 a real
 * claim was rejected twice and landed on attempt 3 of 4 — a slower backend
 * would have exhausted the retries and pushed a committed swap to recovery.
 */

export type BroadcastErrorKind = 'alreadyKnown' | 'missingInputs' | 'other';

const ALREADY_KNOWN =
  /txn-already-in-mempool|txn-already-known|already in (?:the )?block ?chain|outputs already in utxo set|same-nonwitness-data-in-mempool/i;
const MISSING_INPUTS = /missing[- ]?inputs|inputs[- ]?missing|missingorspent|not found/i;

/** The underlying message, or '' when there is none (BDK often gives none). */
export function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message || (error.name !== 'Error' ? error.name : '');
  return String(error ?? '');
}

/**
 * - `alreadyKnown`: the backend already has this exact transaction — the
 *   broadcast has, in effect, succeeded.
 * - `missingInputs`: the input it spends isn't visible to the backend yet.
 *   BDK has historically surfaced this with an empty message (#481), so an
 *   empty message is classed here too.
 * - `other`: anything else (policy rejection, socket error, …).
 */
export function classifyBroadcastError(error: unknown): BroadcastErrorKind {
  const detail = errorDetail(error);
  if (!detail.trim()) return 'missingInputs';
  if (ALREADY_KNOWN.test(detail)) return 'alreadyKnown';
  if (MISSING_INPUTS.test(detail)) return 'missingInputs';
  return 'other';
}

export interface RetryTiming {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** How long to wait for the lockup to reach our backend before the first
 *  claim broadcast. Bounded: the broadcast retry below is authoritative. */
export const LOCKUP_VISIBILITY_TIMEOUT_MS = 30_000;

/**
 * Poll `probe` (does the backend know the tx yet?) with a short backoff
 * until it says yes or `timeoutMs` passes. A `null` answer means the probe
 * can't tell (no Esplora for this backend, or a network error), so we stop
 * waiting rather than stall the claim. Never throws.
 */
export async function waitForTxVisible(
  probe: () => Promise<boolean | null>,
  timeoutMs: number = LOCKUP_VISIBILITY_TIMEOUT_MS,
  { sleep = defaultSleep, now = Date.now }: RetryTiming = {},
): Promise<boolean> {
  const deadline = now() + timeoutMs;
  let delayMs = 1000;
  for (;;) {
    let known: boolean | null;
    try {
      known = await probe();
    } catch {
      known = null;
    }
    if (known !== false) return known === true;
    const remaining = deadline - now();
    if (remaining <= 0) return false;
    await sleep(Math.min(delayMs, remaining));
    delayMs = Math.min(delayMs * 2, 5000);
  }
}

export interface BroadcastRetryOptions extends RetryTiming {
  /** Attempts for errors of kind `other` (the pre-#1174 behaviour). */
  maxAttempts?: number;
  /** Keep retrying `missingInputs` until this much time has passed since
   *  the first attempt. 0 = treat them like `other`. */
  missingInputsWindowMs?: number;
}

/** Longest the claim keeps retrying a not-yet-visible lockup before handing
 *  the (committed) swap to recovery. */
export const CLAIM_MISSING_INPUTS_WINDOW_MS = 120_000;
const MAX_BACKOFF_MS = 15_000;

/**
 * Broadcast with bounded exponential backoff (2 s doubling, capped at 15 s).
 * `alreadyKnown` counts as success. `missingInputs` keeps retrying for
 * `missingInputsWindowMs`; other errors get `maxAttempts` tries. On giving
 * up, throws with the last underlying message so the caller never shows a
 * bare "unknown Error".
 */
export async function broadcastWithRetry(
  fn: () => Promise<void>,
  label: 'claim' | 'refund',
  txId: string,
  {
    maxAttempts = 4,
    missingInputsWindowMs = 0,
    sleep = defaultSleep,
    now = Date.now,
  }: BroadcastRetryOptions = {},
): Promise<void> {
  const started = now();
  let delayMs = 2000;
  let lastError: unknown;
  let otherFailures = 0;
  for (let attempt = 1; ; attempt++) {
    try {
      await fn();
      if (attempt > 1) console.log(`[Boltz] ${label} broadcast succeeded on attempt ${attempt}`);
      return;
    } catch (e) {
      lastError = e;
      const kind = classifyBroadcastError(e);
      const detail = errorDetail(e);
      if (kind === 'alreadyKnown') {
        console.log(`[Boltz] ${label} ${txId} already known to the backend: ${detail}`);
        return;
      }
      console.warn(
        `[Boltz] ${label} broadcast attempt ${attempt} failed (${kind}) for ${txId}: ${detail || '(no message)'}`,
      );
      // A not-yet-visible input is retried until the window closes; any
      // other failure (or every failure, with no window) spends an attempt.
      const giveUp =
        kind === 'missingInputs' && missingInputsWindowMs > 0
          ? now() - started + delayMs > missingInputsWindowMs
          : ++otherFailures >= maxAttempts;
      if (giveUp) break;
      await sleep(delayMs);
      delayMs = Math.min(delayMs * 2, MAX_BACKOFF_MS);
    }
  }
  const detail = errorDetail(lastError);
  throw new Error(
    `Boltz ${label} broadcast failed after ${Math.round((now() - started) / 1000)} s (${detail || 'no underlying message — likely Electrum propagation gap or RPC error'})`,
  );
}
