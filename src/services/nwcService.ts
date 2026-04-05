import { NostrWebLNProvider } from '@getalby/sdk';
import type { Nip47GetInfoResponse, Nip47Transaction } from '@getalby/sdk';

export type { Nip47Transaction };

const providers = new Map<string, NostrWebLNProvider>();

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

    const b = await withRetry(() => provider.getBalance(), {
      label: 'initial getBalance',
      attempts: 2,
      delayMs: 1000,
    });
    const balance = b.balance;

    providers.set(walletId, provider);

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
  const provider = providers.get(walletId);
  if (!provider) return null;
  try {
    const b = await withRetry(() => provider.getBalance(), {
      label: 'getBalance',
      attempts: 2,
      delayMs: 1000,
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
  const provider = providers.get(walletId);
  if (!provider) throw new Error('Not connected');
  const invoice = await provider.makeInvoice({
    amount,
    defaultMemo: memo || 'Lightning Piggy',
  });
  return invoice.paymentRequest;
}

export async function payInvoice(walletId: string, bolt11: string): Promise<{ preimage: string }> {
  const provider = providers.get(walletId);
  if (!provider) throw new Error('Not connected');
  const result = await provider.sendPayment(bolt11);
  return { preimage: result.preimage };
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

export async function listTransactions(walletId: string): Promise<Nip47Transaction[]> {
  const provider = providers.get(walletId);
  if (!provider) return [];
  try {
    const result = await withRetry(() => provider.listTransactions({}), {
      label: 'listTransactions',
      attempts: 2,
      delayMs: 1000,
    });
    return result.transactions || [];
  } catch (error) {
    console.warn(`listTransactions error for ${walletId}:`, error);
    return [];
  }
}

export function isWalletConnected(walletId: string): boolean {
  return providers.has(walletId);
}
