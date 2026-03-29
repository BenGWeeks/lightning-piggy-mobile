import { NostrWebLNProvider } from '@getalby/sdk';
import * as SecureStore from 'expo-secure-store';

const NWC_URL_KEY = 'nwc_connection_url';

let provider: NostrWebLNProvider | null = null;

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
  nwcUrl: string,
): Promise<{ success: boolean; balance?: number; error?: string }> {
  const validation = validateNwcUrl(nwcUrl);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    // Close existing provider if any
    if (provider) {
      try {
        provider.close();
      } catch {}
    }

    provider = new NostrWebLNProvider({
      nostrWalletConnectUrl: nwcUrl.trim(),
    });

    await provider.enable();

    // Get initial balance
    const b = await provider.getBalance();
    const balance = b.balance;

    // Save URL for auto-reconnect
    await SecureStore.setItemAsync(NWC_URL_KEY, nwcUrl.trim());

    return { success: true, balance };
  } catch (error) {
    provider = null;
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

export async function disconnect(): Promise<void> {
  if (provider) {
    try {
      provider.close();
    } catch {}
    provider = null;
  }
  await SecureStore.deleteItemAsync(NWC_URL_KEY);
}

export async function getBalance(): Promise<number | null> {
  if (!provider) return null;
  try {
    const b = await provider.getBalance();
    return b.balance;
  } catch (error) {
    console.warn('getBalance error:', error);
    return null;
  }
}

export async function makeInvoice(amount: number, memo?: string): Promise<string> {
  if (!provider) throw new Error('Not connected');
  const invoice = await provider.makeInvoice({
    amount,
    defaultMemo: memo || 'Lightning Piggy',
  });
  return invoice.paymentRequest;
}

export async function payInvoice(bolt11: string): Promise<{ preimage: string }> {
  if (!provider) throw new Error('Not connected');
  const result = await provider.sendPayment(bolt11);
  return { preimage: result.preimage };
}

export async function getInfo(): Promise<{ alias: string; lud16?: string } | null> {
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

export async function listTransactions(): Promise<any[]> {
  if (!provider) return [];
  try {
    const result = await provider.listTransactions({});
    return result.transactions || [];
  } catch {
    // Not all wallets support listTransactions
    return [];
  }
}

export async function getSavedUrl(): Promise<string | null> {
  return SecureStore.getItemAsync(NWC_URL_KEY);
}

export function isConnected(): boolean {
  return provider !== null;
}
