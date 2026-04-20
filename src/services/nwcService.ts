import { NostrWebLNProvider } from '@getalby/sdk';
import type { Nip47GetInfoResponse } from '@getalby/sdk';

const providers = new Map<string, NostrWebLNProvider>();
const nwcUrls = new Map<string, string>();

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

    patchRelayPublish(provider);

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
 */
function patchRelayPublish(provider: NostrWebLNProvider): void {
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
  patchRelayPublish(provider);
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

export async function payInvoice(walletId: string, bolt11: string): Promise<{ preimage: string }> {
  let provider = await ensureConnected(walletId);
  if (!provider) throw new Error('Not connected');
  try {
    const result = await provider.sendPayment(bolt11);
    return { preimage: result.preimage };
  } catch (error) {
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
      const paymentHash = extractPaymentHash(bolt11);
      if (paymentHash) {
        try {
          const lookup = await provider.lookupInvoice({ payment_hash: paymentHash });
          if (lookup?.preimage) {
            console.log('[NWC] Invoice already paid — returning existing preimage');
            return { preimage: lookup.preimage };
          }
        } catch {
          // lookup failed — fall through to retry. The wallet would refuse
          // duplicate payment for the same payment_hash anyway.
        }
      }
      const result = await provider.sendPayment(bolt11);
      return { preimage: result.preimage };
    }
    if (msg.includes('reply timeout')) {
      // NWC SDK times out after ~60s but the payment may still be in flight.
      // Poll lookupInvoice to check if it completes within 5 minutes.
      console.log('[NWC] pay_invoice timed out, polling for completion...');
      const paymentHash = extractPaymentHash(bolt11);
      if (!paymentHash) throw error;
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
          const lookup = await provider.lookupInvoice({ payment_hash: paymentHash });
          if (lookup?.preimage) {
            console.log('[NWC] Payment completed after timeout:', paymentHash);
            return { preimage: lookup.preimage };
          }
        } catch {
          // keep polling
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

export function isWalletConnected(walletId: string): boolean {
  const provider = providers.get(walletId);
  if (!provider) return false;
  // Check the actual WebSocket connection state
  const client = (provider as any).client;
  return client?.connected ?? false;
}
