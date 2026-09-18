import type { Nip47Transaction } from '@getalby/sdk';
import { pinNip04IfNoInfoEvent, clearEncryptionDecision } from './nwcEncryption';

/** A read-only request on a private connection; never replace the UI's client. */
export async function readBackgroundPayments(
  url: string,
  signal: AbortSignal,
): Promise<Nip47Transaction[]> {
  // Load the SDK only for an opted-in background request, not during headless task registration.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NostrWebLNProvider } = require('@getalby/sdk') as typeof import('@getalby/sdk');
  const provider = new NostrWebLNProvider({ nostrWalletConnectUrl: url });
  const cacheKey = `background-payment-${Date.now()}-${Math.random()}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  const close = () => {
    try {
      provider.close();
    } catch {
      /* already disconnected */
    }
  };
  let cancel: () => void = () => {};
  const deadline = new Promise<never>((_, reject) => {
    cancel = () => {
      cancelled = true;
      close();
      reject(new Error('Background wallet request cancelled or timed out'));
    };
    timer = setTimeout(cancel, 25_000);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
  try {
    return await Promise.race([
      deadline,
      (async () => {
        try {
          if (cancelled) throw new Error('Cancelled');
          await provider.enable();
          if (cancelled) throw new Error('Cancelled');
          await pinNip04IfNoInfoEvent(provider, cacheKey);
          if (cancelled) throw new Error('Cancelled');
          // No `from`: some wallets filter creation time, missing invoices made
          // earlier but settled now. Select by settlement time in the worker.
          // Same public WebLN wrapper nwcService.listTransactions uses.
          const result = await provider.listTransactions({
            type: 'incoming',
            unpaid: false,
            limit: 100,
          });
          return result.transactions;
        } finally {
          // enable/probe can settle after cancellation; close any late socket.
          if (cancelled) {
            close();
            clearEncryptionDecision(cacheKey);
          }
        }
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
    clearEncryptionDecision(cacheKey);
    close();
  }
}
