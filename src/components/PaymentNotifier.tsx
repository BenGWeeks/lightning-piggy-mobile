import { useEffect, useRef } from 'react';
import { useWallet, useWalletLive } from '../contexts/WalletContext';
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
 * Classification waits for the settled tx: `lastIncomingPayment` can be set
 * by the expectPayment fast-path BEFORE `fetchTransactions` has populated the
 * tx list, so the lookup would miss and a zap would misfire as a plain
 * receive. We therefore react to `wallets` updates too, fire once the tx is
 * found, and only fall back to a generic "payment" notification if the tx
 * never materialises within a short grace window.
 *
 * Lives outside WalletContext to keep that (over-cap) file from growing —
 * see #703.
 */
const TX_SETTLE_GRACE_MS = 5000;

export default function PaymentNotifier(): null {
  const { wallets } = useWallet();
  const { lastIncomingPayment } = useWalletLive();
  // Hashes we've already fired for — guarantees once-per-payment across both
  // the immediate path and the deferred (tx-arrived / timeout) paths.
  const announced = useRef<Set<string>>(new Set());
  // Fallback timers per pending hash, so we can cancel the generic fire if
  // the precise tx shows up first.
  const fallbackTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!lastIncomingPayment) return;
    const { walletId, amountSats, paymentHash, at } = lastIncomingPayment;
    // On-chain receives can lack a payment hash; fall back to a
    // wallet+amount+timestamp key so two distinct same-amount receives to the
    // same wallet (which `walletId:amountSats` alone would collapse) each still
    // notify. `at` is stable per detection, so re-renders dedupe correctly.
    const dedupeKey = paymentHash ?? `${walletId}:${amountSats}:${at}`;
    if (announced.current.has(dedupeKey)) return;

    const tx = wallets
      .find((w) => w.id === walletId)
      ?.transactions?.find((t) => t.paymentHash === paymentHash);

    if (tx) {
      // tx settled → classify precisely and fire exactly once.
      announced.current.add(dedupeKey);
      const timer = fallbackTimers.current.get(dedupeKey);
      if (timer) {
        clearTimeout(timer);
        fallbackTimers.current.delete(dedupeKey);
      }
      const zap = tx.zapCounterparty ?? null;
      void firePaymentNotification({
        kind: zap ? 'zap' : 'payment',
        amountSats,
        walletId,
        comment: zap?.comment || tx.description || undefined,
      });
      return;
    }

    // tx not in the list yet — wait for a wallet refresh (this effect also
    // re-runs on `wallets`) to classify it, but fall back to a generic
    // payment notification if the tx never arrives.
    if (!fallbackTimers.current.has(dedupeKey)) {
      const timer = setTimeout(() => {
        fallbackTimers.current.delete(dedupeKey);
        if (announced.current.has(dedupeKey)) return;
        announced.current.add(dedupeKey);
        void firePaymentNotification({ kind: 'payment', amountSats, walletId });
      }, TX_SETTLE_GRACE_MS);
      fallbackTimers.current.set(dedupeKey, timer);
    }
  }, [lastIncomingPayment, wallets]);

  // Clear any outstanding fallback timers on unmount.
  useEffect(() => {
    const timers = fallbackTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  return null;
}
