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

    await withRetry(() => provider.enable(), { label: 'connect', attempts: 3, delayMs: 2000 });

    // Allow relay connection to stabilize before first request
    await new Promise((r) => setTimeout(r, 500));

    const b = await withRetry(() => provider.getBalance(), {
      label: 'initial getBalance',
      attempts: 3,
      delayMs: 2000,
    });
    const balance = b.balance;

    providers.set(walletId, provider);
    nwcUrls.set(walletId, nwcUrl.trim());

    return { success: true, balance };
  } catch (error) {
    providers.delete(walletId);
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
  let provider = providers.get(walletId);
  if (!provider) return null;
  try {
    const b = await provider.getBalance();
    return b.balance;
  } catch (error) {
    const msg = error instanceof Error ? error.message : '';
    if (msg.includes('failed to publish') && nwcUrls.has(walletId)) {
      try {
        provider = await reconnect(walletId);
        const b = await provider.getBalance();
        return b.balance;
      } catch {
        return null;
      }
    }
    console.warn(`getBalance error for ${walletId}:`, error);
    return null;
  }
}

export async function makeInvoice(
  walletId: string,
  amount: number,
  memo?: string,
): Promise<string> {
  const provider = providers.get(walletId);
  if (!provider) throw new Error('Not connected');
  const invoice = await provider.makeInvoice({
    amount,
    defaultMemo: memo || 'Lightning Piggy',
  });
  return invoice.paymentRequest;
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
  await provider.enable();
  providers.set(walletId, provider);
  return provider;
}

export async function payInvoice(walletId: string, bolt11: string): Promise<{ preimage: string }> {
  let provider = providers.get(walletId);
  if (!provider) throw new Error('Not connected');
  try {
    const result = await provider.sendPayment(bolt11);
    return { preimage: result.preimage };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('failed to publish')) {
      // Relay connection likely dropped. Reconnect and retry once.
      // This is safe because 'failed to publish' means the request
      // never reached the wallet — the payment was NOT sent.
      if (__DEV__) console.log('[NWC] Publish failed, reconnecting relay and retrying...');
      provider = await reconnect(walletId);
      const result = await provider.sendPayment(bolt11);
      return { preimage: result.preimage };
    }
    throw error;
  }
}

/**
 * Pay an invoice without waiting for the relay response.
 * Use this for payments where the relay may timeout before the payment
 * confirmation comes back (e.g. larger Boltz swap invoices).
 * The payment is still sent — only the confirmation is skipped.
 */
export async function payInvoiceAsync(walletId: string, bolt11: string): Promise<void> {
  const provider = providers.get(walletId);
  if (!provider) throw new Error('Not connected');
  await provider.sendPaymentAsync(bolt11);
}

export async function getInfo(walletId: string): Promise<{ alias: string; lud16?: string } | null> {
  const provider = providers.get(walletId);
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
  let provider = providers.get(walletId);
  if (!provider) return [];
  try {
    const result = await provider.listTransactions({});
    return result.transactions || [];
  } catch (error) {
    const msg = error instanceof Error ? error.message : '';
    if (msg.includes('failed to publish') && nwcUrls.has(walletId)) {
      try {
        provider = await reconnect(walletId);
        const result = await provider.listTransactions({});
        return result.transactions || [];
      } catch {
        return [];
      }
    }
    console.warn(`listTransactions error for ${walletId}:`, error);
    return [];
  }
}

export function isWalletConnected(walletId: string): boolean {
  return providers.has(walletId);
}
