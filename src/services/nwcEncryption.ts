import type { NostrWebLNProvider } from '@getalby/sdk';

// Per-wallet "pin to NIP-04" decision, persisted across reconnects so we don't
// re-probe noisy relays on every connect (CoinOS temp-bans busy IPs, #737). We
// deliberately cache ONLY the negative ('nip04') outcome — caching a positive
// 'negotiate' decision would permanently downgrade a NIP-44-capable wallet to
// NIP-04 if its kind-13194 info event was briefly unavailable when we last
// probed (Copilot review #738). Re-probing on each connect for the 'negotiate'
// path is one bounded relay call and lets a wallet whose info event appears
// later recover automatically.
const encryptionDecision = new Map<string, 'nip04'>();

type NwcInternals = {
  client?: { _encryptionType?: string; getWalletServiceInfo?: () => Promise<unknown> };
};

// Bounded wait for the info-event probe. `client.getWalletServiceInfo()` opens
// a relay subscription that resolves on EOSE — against a slow / temp-banned
// relay (the very scenario this probe is meant to harden), the SDK's own
// internal timeout (or lack thereof) can stall connect() for many seconds or
// indefinitely. We cap it ourselves and treat a timeout the same as "no info
// event" → pin NIP-04 (Copilot review #738). The SDK's underlying subscription
// may continue briefly until its own bound, but our connect() path is no
// longer blocked.
const PROBE_TIMEOUT_MS = 5_000;
const PROBE_TIMEOUT_MARKER = 'probe-timeout';

function probeWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(PROBE_TIMEOUT_MARKER)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// Some NWC wallets (notably CoinOS) never publish a kind-13194 info event yet
// still speak NIP-47 over NIP-04. @getalby/sdk negotiates encryption from that
// event before every command and throws "no info event (kind 13194)" when it's
// absent — bricking invoice/claim/balance. After connecting, probe once with a
// bounded timeout; if the event is missing (or the probe times out against a
// slow / banned relay), pin NIP-04 (the SDK's own baseline) and cache the
// decision so reconnects skip the probe straight away.
export async function pinNip04IfNoInfoEvent(
  provider: NostrWebLNProvider,
  walletId: string,
): Promise<void> {
  const client = (provider as unknown as NwcInternals).client;
  if (!client || typeof client.getWalletServiceInfo !== 'function' || client._encryptionType) {
    return;
  }

  if (encryptionDecision.get(walletId) === 'nip04') {
    client._encryptionType = 'nip04';
    return;
  }

  try {
    await probeWithTimeout(client.getWalletServiceInfo(), PROBE_TIMEOUT_MS);
    // Info event present → let the SDK negotiate normally. Don't cache the
    // positive outcome — see the encryptionDecision comment above.
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // "no info event" / "kind 13194 missing" → the wallet doesn't publish one.
    // Our own probe-timeout → relay is too slow / temp-banned to answer in
    // time; treat the same way so we don't hang connect() indefinitely.
    if (/no info event|kind ?13194/i.test(msg) || msg === PROBE_TIMEOUT_MARKER) {
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
