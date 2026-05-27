import type { NostrWebLNProvider } from '@getalby/sdk';

// Per-wallet encryption decision, cached so reconnects don't re-probe the relay.
// Each probe is a subscription that adds load, and noisy relays (CoinOS) temp-ban
// busy IPs — so we decide once per wallet and reuse it. (#737)
//   'nip04'     → wallet publishes no kind-13194 info event; pin NIP-04.
//   'negotiate' → info event present; let the SDK negotiate normally.
const encryptionDecision = new Map<string, 'nip04' | 'negotiate'>();

type NwcInternals = {
  client?: { _encryptionType?: string; getWalletServiceInfo?: () => Promise<unknown> };
};

// Some NWC wallets (notably CoinOS) never publish a kind-13194 info event yet
// still speak NIP-47 over NIP-04. @getalby/sdk negotiates encryption from that
// event before every command and throws "no info event (kind 13194)" when it's
// absent — bricking invoice/claim/balance. After connecting, probe once; if the
// event is missing, pin NIP-04 (the SDK's own baseline). The decision is cached
// per wallet so reconnects set it straight away without another relay probe.
export async function pinNip04IfNoInfoEvent(
  provider: NostrWebLNProvider,
  walletId: string,
): Promise<void> {
  const client = (provider as unknown as NwcInternals).client;
  if (!client || typeof client.getWalletServiceInfo !== 'function' || client._encryptionType) {
    return;
  }

  const cached = encryptionDecision.get(walletId);
  if (cached === 'nip04') {
    client._encryptionType = 'nip04';
    return;
  }
  if (cached === 'negotiate') return;

  try {
    await client.getWalletServiceInfo();
    encryptionDecision.set(walletId, 'negotiate');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/no info event|kind ?13194/i.test(msg)) {
      client._encryptionType = 'nip04';
      encryptionDecision.set(walletId, 'nip04');
    }
  }
}

// Forget a wallet's cached decision — call when the wallet is removed so a later
// re-add (e.g. a different NWC URL under the same id) re-probes fresh.
export function clearEncryptionDecision(walletId: string): void {
  encryptionDecision.delete(walletId);
}
