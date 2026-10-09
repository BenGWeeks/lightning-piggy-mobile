import type { IncomingPaymentSource } from './incomingPaymentSource';

/** One settled receive, published to the overlay / notifier / sheets. */
export interface IncomingPayment {
  walletId: string;
  amountSats: number;
  // Timestamp; also serves as a stable React key for the overlay so a
  // second payment with the same amount to the same wallet still
  // re-mounts the animation.
  at: number;
  // The settled invoice's payment hash. Set on both detection paths now —
  // expectPayment (by lookup) and the transaction-list detector (by tx
  // identity). Kept nullable for backward-compat.
  paymentHash: string | null;
  // Which rail delivered this credit. Lets the overlay surface a
  // small visual distinction (#134) — on-chain receives include a
  // mempool/confirmation hint subtitle so users know an unconfirmed
  // tx isn't yet final, while lightning lands instantly settled.
  // Shared `IncomingPaymentSource` union (not an inline literal) so the
  // event and the overlay's `ReceiveSource` prop can't drift as new
  // rails are added.
  source: IncomingPaymentSource;
  // True when the receipt was found in an already-current transaction list, so
  // the post-receive refresh effect can skip a redundant list_transactions
  // round-trip (#655 review).
  fromTxList?: boolean;
  // The wallet-reported settlement time (Unix seconds), when it gave one —
  // never the invoice's creation time. A receipt that settled well before
  // we noticed it is catch-up news: no celebration, a quiet notification.
  settledAt?: number;
}
