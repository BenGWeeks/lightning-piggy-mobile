import { createContext, useContext } from 'react';
import type { IncomingPayment } from './WalletContext';

/**
 * The high-frequency "live" wallet slices (#801). Split out of `WalletContext`
 * because these change far more often than the wallet list / actions:
 *
 *  - `btcPrice` — re-`setState`'d on every fiat-price poll (~30 s), read by
 *    ~11 consumers (every screen that shows a sats↔fiat amount).
 *  - `lastIncomingPayment` — fires on every settled receive, read by ~4
 *    (PaymentNotifier, ReceiveSheet, LnurlWithdrawSheet, NfcReadSheet).
 *
 * Left in the same `useWallet()` value they re-rendered all ~24 consumers on
 * every poll/receive. Served from a sibling provider (mirrors the #806
 * `dmInbox` split) so only consumers that actually read price/receive state
 * re-render. The wallet list / balance churn (`wallets`) is NOT split here —
 * it's derived state most consumers read together, so it needs the selector
 * store in #803, not a sibling context.
 *
 * The provider is wired in `WalletProvider` (which owns the underlying state);
 * this module owns only the context object, its type, and the consumer hook.
 */
export interface WalletLiveContextType {
  btcPrice: number | null;
  lastIncomingPayment: IncomingPayment | null;
  clearLastIncomingPayment: () => void;
}

export const WalletLiveContext = createContext<WalletLiveContextType | undefined>(undefined);

/**
 * Access the live wallet slices (`btcPrice`, `lastIncomingPayment`) (#801).
 * Served from a sibling provider so consumers of this hook re-render on
 * price/receive updates while plain `useWallet()` consumers do not.
 */
export function useWalletLive() {
  const context = useContext(WalletLiveContext);
  if (!context) {
    throw new Error('useWalletLive must be used within a WalletProvider');
  }
  return context;
}
