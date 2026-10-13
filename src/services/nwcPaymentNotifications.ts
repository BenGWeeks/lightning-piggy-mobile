import type { NostrWebLNProvider, Nip47Notification } from '@getalby/sdk';
import type { PaymentCandidate } from '../utils/paymentCompletion';
import { throwIfAborted } from './nwcErrors';

/** Payment-scoped NIP-47 notifications. The SDK's subscribeNotifications has an
 * unbounded filter; use its pool/decrypt with a bounded filter instead. Lookup
 * remains available if this short-lived subscription disconnects. */
export async function subscribePaymentSent(
  client: NostrWebLNProvider['client'],
  paymentHash: string,
  accept: (candidate: PaymentCandidate) => void,
  signal: AbortSignal,
): Promise<() => void> {
  // Include settlements during slow discovery/negotiation, plus clock skew.
  const since = Math.floor(Date.now() / 1000) - 5;
  const info = await client.getWalletServiceInfo();
  throwIfAborted(signal);
  if (!info.notifications?.includes('payment_sent')) return () => {};
  // Same SDK negotiation as pay_invoice, including the app's pinned NIP-04 decision.
  const internals = client as unknown as { _selectEncryptionType?: () => Promise<void> };
  if (!internals._selectEncryptionType || !client.pool?.subscribe) return () => {};
  await internals._selectEncryptionType();
  throwIfAborted(signal);
  const sub = client.pool.subscribe(
    client.relayUrls,
    {
      kinds: [client.encryptionType === 'nip04' ? 23196 : 23197],
      authors: [client.walletPubkey],
      '#p': [client.publicKey],
      since,
      limit: 10,
    },
    {
      onevent: async (event) => {
        if (signal.aborted) return;
        try {
          const notification: Nip47Notification = JSON.parse(
            await client.decrypt(client.walletPubkey, event.content),
          );
          if (
            !signal.aborted &&
            notification.notification_type === 'payment_sent' &&
            notification.notification?.payment_hash?.toLowerCase() === paymentHash.toLowerCase()
          ) {
            accept(notification.notification);
          }
        } catch {
          // Malformed/unreadable notifications cannot confirm a payment.
        }
      },
    },
  );
  return () => sub.close();
}
