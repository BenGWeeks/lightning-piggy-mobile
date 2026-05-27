import { useEffect } from 'react';
import { useWallet } from '../contexts/WalletContext';
import { firePaymentNotification } from '../services/notificationService';

/**
 * OS notification for incoming payments (#279). Mounted once at the app
 * root (inside WalletProvider). Funnels through `lastIncomingPayment`, so it
 * covers BOTH the expectPayment fast-path and the tx-list receive detector
 * with one hook, inheriting their announce-once-per-hash dedupe. Looks up
 * the settled tx to tell a NIP-57 zap (has a zap counterparty) from a plain
 * receive, and to pull a zap comment / memo for the body. Never suppressed —
 * money landing is always worth surfacing.
 *
 * Lives outside WalletContext to keep that (over-cap) file from growing —
 * see #703.
 */
export default function PaymentNotifier(): null {
  const { wallets, lastIncomingPayment } = useWallet();
  useEffect(() => {
    if (!lastIncomingPayment) return;
    const { walletId, amountSats, paymentHash } = lastIncomingPayment;
    const tx = wallets
      .find((w) => w.id === walletId)
      ?.transactions?.find((t) => t.paymentHash === paymentHash);
    const zap = tx?.zapCounterparty ?? null;
    void firePaymentNotification({
      kind: zap ? 'zap' : 'payment',
      amountSats,
      walletId,
      comment: zap?.comment || tx?.description || undefined,
    });
    // Only fire on a new detected receive; `wallets` is read for tx lookup
    // but must not re-trigger this on unrelated wallet updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastIncomingPayment]);
  return null;
}
