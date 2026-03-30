import { NostrWebLNProvider } from '@getalby/sdk';

const providers = new Map<string, NostrWebLNProvider>();

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

    await provider.enable();

    const b = await provider.getBalance();
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
    const b = await provider.getBalance();
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

export async function payInvoice(
  walletId: string,
  bolt11: string,
): Promise<{ preimage: string }> {
  const provider = providers.get(walletId);
  if (!provider) throw new Error('Not connected');
  const result = await provider.sendPayment(bolt11);
  return { preimage: result.preimage };
}

export async function getInfo(
  walletId: string,
): Promise<{ alias: string; lud16?: string } | null> {
  const provider = providers.get(walletId);
  if (!provider) return null;
  try {
    const info: any = await provider.getInfo();
    console.log('NWC getInfo response:', JSON.stringify(info));
    const alias = info.node?.alias || info.alias || '';
    const lud16 = info.node?.lud16 || info.lud16;
    return { alias, lud16 };
  } catch (error) {
    console.warn('NWC getInfo failed:', error);
    return null;
  }
}

export async function listTransactions(walletId: string): Promise<any[]> {
  const provider = providers.get(walletId);
  if (!provider) return [];
  try {
    const result = await provider.listTransactions({});
    return result.transactions || [];
  } catch {
    return [];
  }
}

export function isWalletConnected(walletId: string): boolean {
  return providers.has(walletId);
}
