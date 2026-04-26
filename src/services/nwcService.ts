import { NostrWebLNProvider } from '@getalby/sdk';
import type { Nip47GetInfoResponse } from '@getalby/sdk';

const providers = new Map<string, NostrWebLNProvider>();
const nwcUrls = new Map<string, string>();

// Per-wallet timestamp of the most recent relay-publish failure. Used
// to fast-fail pay_invoice when the relay is unreachable (see #175).
// A "reply timeout" that lands within PUBLISH_FAILURE_FRESH_MS of a
// publish failure means the request never reached the wallet, so
// polling for the preimage is pointless — raise straight away.
const lastPublishFailureAt = new Map<string, number>();
const PUBLISH_FAILURE_FRESH_MS = 10_000;

function markPublishFailure(walletId: string): void {
  lastPublishFailureAt.set(walletId, Date.now());
}

function hasRecentPublishFailure(walletId: string): boolean {
  const ts = lastPublishFailureAt.get(walletId);
  if (!ts) return false;
  if (Date.now() - ts > PUBLISH_FAILURE_FRESH_MS) {
    lastPublishFailureAt.delete(walletId);
    return false;
  }
  return true;
}

/** Standard DOMException-shape abort error: `name === 'AbortError'`.
 * Callers can detect via `error.name === 'AbortError'` or by checking
 * `signal.aborted` after await. */
export function createAbortError(message = 'Payment cancelled'): Error {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError();
}

/** Sleep that rejects with AbortError if the signal fires, instead of
 * resolving on schedule. Without this the 5-minute poll loop below
 * ignores cancellation between polls. */
function abortableSleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Race a non-cancellable promise against an AbortSignal so the caller
 * can stop waiting even while the underlying SDK call keeps running.
 * The background promise is allowed to complete; its result is just
 * discarded if abort wins the race. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(createAbortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(createAbortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, delayMs = 1000, label = 'operation' } = {},
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === attempts - 1) throw error;
      if (__DEV__)
        console.log(`[NWC] ${label} attempt ${i + 1} failed, retrying in ${delayMs}ms...`);
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs *= 2; // exponential backoff
    }
  }
  throw new Error('unreachable');
}

export function validateNwcUrl(url: string): { valid: boolean; error?: string } {
  url = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
  if (parsed.protocol.toLowerCase() !== 'nostr+walletconnect:') {
    return { valid: false, error: 'URL must start with nostr+walletconnect://' };
  }
  if (!/^[0-9a-fA-F]{64}$/.test(parsed.hostname)) {
    return { valid: false, error: 'Invalid pubkey in URL (must be 64 hex characters)' };
  }
  if (parsed.searchParams.getAll('relay').length === 0) {
    return { valid: false, error: 'Missing relay parameter' };
  }
  if (!parsed.searchParams.get('secret')) {
    return { valid: false, error: 'Missing secret parameter' };
  }
  return { valid: true };
}

export async function connect(
  walletId: string,
  nwcUrl: string,
): Promise<{ success: boolean; balance?: number; error?: string }> {
  const validation = validateNwcUrl(nwcUrl);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    // Close existing provider for this wallet if any
    const existing = providers.get(walletId);
    if (existing) {
      try {
        existing.close();
      } catch {}
    }

    const provider = new NostrWebLNProvider({
      nostrWalletConnectUrl: nwcUrl.trim(),
    });

    patchRelayPublish(provider, walletId);

    await withRetry(() => provider.enable(), { label: 'connect', attempts: 3, delayMs: 2000 });

    // Store provider immediately after enable() — the relay connection is
    // established even if getBalance fails (e.g. slow relay response).
    providers.set(walletId, provider);
    nwcUrls.set(walletId, nwcUrl.trim());

    // Allow relay connection to stabilize before first request
    await new Promise((r) => setTimeout(r, 500));

    // Try to get initial balance, but don't fail the connection if it times out
    let balance: number | undefined;
    try {
      const b = await withRetry(() => provider.getBalance(), {
        label: 'initial getBalance',
        attempts: 3,
        delayMs: 2000,
      });
      balance = b.balance;
    } catch {
      if (__DEV__) console.log('[NWC] Initial getBalance failed, wallet still connected');
    }

    return { success: true, balance };
  } catch (error) {
    providers.delete(walletId);
    nwcUrls.delete(walletId);
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

export function disconnect(walletId: string): void {
  const provider = providers.get(walletId);
  if (provider) {
    try {
      provider.close();
    } catch {}
    providers.delete(walletId);
  }
}

export async function getBalance(walletId: string): Promise<number | null> {
  const provider = await ensureConnected(walletId);
  if (!provider) return null;
  try {
    // Retry twice on slow relays so a single timeout doesn't show the
    // wallet as "Disconnected" / flash a null balance.
    const b = await withRetry(() => provider.getBalance(), {
      label: `getBalance(${walletId})`,
      attempts: 2,
      delayMs: 1500,
    });
    return b.balance;
  } catch (error) {
    console.warn(`getBalance error for ${walletId}:`, error);
    return null;
  }
}

export async function makeInvoice(
  walletId: string,
  amount: number,
  memo?: string,
): Promise<string> {
  const provider = await ensureConnected(walletId);
  if (!provider) throw new Error('Not connected');
  const invoice = await provider.makeInvoice({
    amount,
    defaultMemo: memo || 'Lightning Piggy',
  });
  return invoice.paymentRequest;
}

/**
 * Patch the relay pool to not wait for NIP-20 OK responses.
 * The LNbits Nostrclient relay proxy doesn't send OK responses
 * (see https://github.com/lnbits/nostrclient/issues/52),
 * causing every publish to timeout. This patches the relay's
 * publish method to resolve immediately after sending.
 *
 * Can be removed once lnbits/nostrclient#68 is merged upstream.
 *
 * When the fire-and-forget publish rejects (e.g. the relay is
 * unreachable), we record the timestamp per-walletId so payInvoice
 * can fast-fail instead of waiting 5 min for a preimage that's
 * never going to arrive (see #175).
 */
function patchRelayPublish(provider: NostrWebLNProvider, walletId: string): void {
  try {
    const pool = (provider as any).client?.pool;
    if (pool) {
      const origEnsureRelay = pool.ensureRelay.bind(pool);
      pool.ensureRelay = async (url: string, opts?: any) => {
        const relay = await origEnsureRelay(url, opts);
        if (relay && !relay._publishPatched) {
          relay._publishPatched = true;
          const origPublish = relay.publish.bind(relay);
          relay.publish = (event: any) => {
            origPublish(event).catch((err: unknown) => {
              console.warn('[NWC] Relay publish failed (fire-and-forget):', err);
              markPublishFailure(walletId);
            });
            return Promise.resolve(); // resolve immediately
          };
        }
        return relay;
      };
    }
  } catch {
    // If patching fails, continue with default behavior
  }
}

/**
 * Reconnect an NWC provider if the relay connection dropped.
 * Closes the old provider and creates a fresh one.
 */
async function reconnect(walletId: string): Promise<NostrWebLNProvider> {
  const url = nwcUrls.get(walletId);
  if (!url) throw new Error('No NWC URL stored for reconnect');

  const existing = providers.get(walletId);
  if (existing) {
    try {
      existing.close();
    } catch {}
  }

  const provider = new NostrWebLNProvider({ nostrWalletConnectUrl: url });
  patchRelayPublish(provider, walletId);
  await provider.enable();
  providers.set(walletId, provider);
  return provider;
}

/**
 * Ensure the NWC provider is connected. Reconnect if the WebSocket dropped.
 * Returns null if no provider exists for this wallet.
 */
async function ensureConnected(walletId: string): Promise<NostrWebLNProvider | null> {
  let provider = providers.get(walletId);
  if (!provider) return null;

  const client = (provider as any).client;
  if (client && !client.connected && nwcUrls.has(walletId)) {
    if (__DEV__) console.log('[NWC] Connection lost, reconnecting...');
    provider = await reconnect(walletId);
  }
  return provider;
}

export async function payInvoice(
  walletId: string,
  bolt11: string,
  signal?: AbortSignal,
): Promise<{ preimage: string }> {
  throwIfAborted(signal);
  let provider = await ensureConnected(walletId);
  if (!provider) throw new Error('Not connected');
  try {
    const result = await provider.sendPayment(bolt11);
    throwIfAborted(signal);
    return { preimage: result.preimage };
  } catch (error) {
    // Propagate user-initiated cancel straight away.
    if ((error as Error)?.name === 'AbortError') throw error;
    throwIfAborted(signal);

    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('failed to publish')) {
      // 'failed to publish' from nostr-tools usually means the event never
      // reached the wallet — but if the relay accepted then dropped the
      // ack, a blind retry would send a second NIP-47 request for the
      // same invoice and some wallets may pay twice. Always look up the
      // invoice first; only retry the payment if it isn't already settled
      // or in flight.
      if (__DEV__)
        console.log(
          '[NWC] Publish failed, checking invoice status before retry to avoid double-pay...',
        );
      provider = await reconnect(walletId);
      throwIfAborted(signal);
      const paymentHash = extractPaymentHash(bolt11);
      if (paymentHash) {
        try {
          const lookup = await provider.lookupInvoice({ paymentHash });
          if (lookup?.preimage) {
            console.log('[NWC] Invoice already paid — returning existing preimage');
            return { preimage: lookup.preimage };
          }
        } catch {
          // lookup failed — fall through to retry. The wallet would refuse
          // duplicate payment for the same payment_hash anyway.
        }
      }
      throwIfAborted(signal);
      const result = await provider.sendPayment(bolt11);
      return { preimage: result.preimage };
    }
    if (msg.includes('reply timeout')) {
      // If the relay's fire-and-forget publish just failed, the NIP-47
      // request never reached the wallet. Don't waste 5 minutes polling
      // lookupInvoice for a preimage that isn't coming — bail out now
      // with a message the humanizer can turn into the UX string.
      if (hasRecentPublishFailure(walletId)) {
        console.log('[NWC] pay_invoice reply timeout + recent publish failure — failing fast');
        throw new Error("Couldn't reach your wallet: relay publish timed out");
      }

      // NWC SDK times out after ~60s but the payment may still be in flight.
      // Poll lookupInvoice to check if it completes within 5 minutes.
      console.log('[NWC] pay_invoice timed out, polling for completion...');
      const paymentHash = extractPaymentHash(bolt11);
      if (!paymentHash) throw error;
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        // abortableSleep rejects with AbortError when the caller cancels,
        // so the poll loop exits immediately on a Cancel tap.
        await abortableSleep(5000, signal);
        if (hasRecentPublishFailure(walletId)) {
          throw new Error("Couldn't reach your wallet: relay publish timed out");
        }
        try {
          // `abortable` lets Cancel win the race even while the SDK is
          // blocked inside lookupInvoice's own NIP-47 round-trip; the
          // underlying promise completes in the background and its
          // result is discarded.
          const lookup = await abortable(provider.lookupInvoice({ paymentHash }), signal);
          if (lookup?.preimage) {
            console.log('[NWC] Payment completed after timeout:', paymentHash);
            return { preimage: lookup.preimage };
          }
        } catch (err) {
          // AbortError must propagate so the caller sees the cancel.
          if ((err as Error)?.name === 'AbortError') throw err;
          // Any other lookupInvoice failure — keep polling.
        }
      }
    }
    throw error;
  }
}

function extractPaymentHash(bolt11: string): string | null {
  try {
    // Simple bolt11 payment_hash extraction — it's tag 'p' (01 in bech32)
    // For reliability, decode with light-bolt11-decoder if available
    const { decode } = require('light-bolt11-decoder');
    const decoded = decode(bolt11);
    const hashSection = decoded.sections?.find((s: { name: string }) => s.name === 'payment_hash');
    return hashSection?.value || null;
  } catch {
    return null;
  }
}

export async function getInfo(walletId: string): Promise<{ alias: string; lud16?: string } | null> {
  const provider = await ensureConnected(walletId);
  if (!provider) return null;
  try {
    const info: Nip47GetInfoResponse = await provider.getInfo();
    if (__DEV__) console.log('NWC getInfo response:', JSON.stringify(info));
    const alias = info.alias || '';
    const lud16 = info.lud16;
    return { alias, lud16 };
  } catch (error) {
    console.warn('NWC getInfo failed:', error);
    return null;
  }
}

export async function listTransactions(walletId: string): Promise<any[]> {
  let provider = await ensureConnected(walletId);
  if (!provider) return [];
  // Retry up to 3 times. The LNbits Nostrclient relay has a sporadic
  // transport race where the first request after startup (or after a
  // period of inactivity) is silently dropped — the server never logs
  // it, the client hits the NWC SDK's ~60s reply timeout. Retrying with
  // a relay reconnect between attempts usually clears it on attempt 2.
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // LNbits's NWC provider defaults to `limit: 10` (see
      // extensions/nwcprovider/tasks.py::_on_list_transactions), so an empty
      // request only returns the 10 most recent payments. 50 is a balance
      // between showing real history and keeping the fetch + follow-up zap
      // resolver fast; bumping higher (100+) made first-load noticeably slow.
      const result = await provider.listTransactions({ limit: 50 });
      return result.transactions || [];
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`listTransactions attempt ${attempt}/${maxAttempts} for ${walletId}:`, msg);
      if (attempt < maxAttempts) {
        // Reconnect the relay before retrying — a stale subscription
        // is the most common cause of the drop.
        try {
          provider = await reconnect(walletId);
        } catch {}
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  return [];
}

// LNbits (and some other NWC backends) omit preimage/invoice from
// list_transactions; this fills them in. Returns null on failure.
// `paid` relies on `settled_at` (a non-zero timestamp when the invoice
// was paid). `preimage` alone isn't a safe signal — some backends
// pre-populate it or return a placeholder while unsettled.
export async function lookupInvoice(
  walletId: string,
  paymentHash: string,
): Promise<{ preimage?: string; invoice?: string; paid: boolean } | null> {
  const provider = await ensureConnected(walletId);
  if (!provider) return null;
  try {
    const result = (await provider.lookupInvoice({ paymentHash })) as {
      preimage?: string;
      invoice?: string;
      settled_at?: number;
    };
    const paid = Boolean(result?.settled_at && result.settled_at > 0);
    return {
      preimage: result?.preimage,
      invoice: result?.invoice,
      paid,
    };
  } catch (error) {
    console.warn(`lookupInvoice failed for ${walletId}:`, error);
    return null;
  }
}

export function isWalletConnected(walletId: string): boolean {
  const provider = providers.get(walletId);
  if (!provider) return false;
  // Check the actual WebSocket connection state
  const client = (provider as any).client;
  return client?.connected ?? false;
}
