import type { WalletTransaction } from '../types/wallet';
import { getSwapMeta } from '../services/swapRecoveryService';
import { preserveOptimisticSwapRows } from './swapPendingMerge';

// The subset of an NWC `list_transactions` row we read. Backends vary, so most
// fields are optional / nullable and normalised to `undefined` on mapping.
export interface NwcRawTransaction {
  type: 'incoming' | 'outgoing';
  amount: number;
  description?: string | null;
  settled_at?: number | null;
  created_at?: number | null;
  invoice?: string;
  payment_hash?: string;
  preimage?: string;
  fees_paid?: number;
}

// Shape raw NWC `list_transactions` rows into `WalletTransaction[]`, carrying
// forward state that the server doesn't round-trip:
//
//   * Resolved zap-counterparty info — so a refresh doesn't re-trigger relay
//     lookups for transactions we've already attributed, and optimistic
//     counterparty entries written at pay-time (see SendSheet) don't flicker
//     out when the LNbits refresh lands.
//   * Optimistic rows SendSheet inserted at pay-time that LNbits hasn't flushed
//     into its ledger yet. Without this a freshly-sent zap would vanish from
//     the conversation thread on the very next refresh, then reappear a second
//     later. Matching uses `paymentHash + type` because a self-pay produces
//     both an incoming and an outgoing leg with the same hash; keying on hash
//     alone would drop our optimistic outgoing leg as soon as the incoming leg
//     came back. The `optimistic` flag scopes preservation to newly-inserted
//     rows, so older historical txs that fall off the list_transactions window
//     aren't regrown.
export function mapNwcTransactions(
  raw: readonly NwcRawTransaction[],
  existing: readonly WalletTransaction[],
): WalletTransaction[] {
  const counterpartyByHash = new Map<string, WalletTransaction['zapCounterparty']>();
  for (const prev of existing) {
    if (prev.paymentHash && prev.zapCounterparty !== undefined) {
      counterpartyByHash.set(prev.paymentHash, prev.zapCounterparty);
    }
  }

  let txs: WalletTransaction[] = raw.map((tx) => {
    // Tag the Lightning leg of a Boltz swap (by payment hash) so it badges as
    // a swap rather than a generic Sent/Received (#895).
    const meta = tx.payment_hash ? getSwapMeta(tx.payment_hash) : undefined;
    return {
      type: tx.type,
      amount: tx.amount,
      description: meta
        ? meta.swapType === 'reverse'
          ? 'Boltz swap — sent via Lightning'
          : 'Boltz swap — received via Lightning'
        : (tx.description ?? undefined),
      settled_at: tx.settled_at ?? undefined,
      created_at: tx.created_at ?? undefined,
      bolt11: tx.invoice,
      invoice: tx.invoice,
      paymentHash: tx.payment_hash,
      preimage: tx.preimage,
      // NWC reports fees in msats; surface as sats for display.
      feesSats: typeof tx.fees_paid === 'number' ? Math.round(tx.fees_paid / 1000) : undefined,
      zapCounterparty: tx.payment_hash ? counterpartyByHash.get(tx.payment_hash) : undefined,
      swapId: meta?.swapId,
      swapType: meta?.swapType,
    };
  });

  const returnedKeys = new Set(
    txs.filter((t) => !!t.paymentHash).map((t) => `${t.type}:${t.paymentHash}`),
  );
  const stillPending = existing.filter(
    (t) => t.optimistic && t.paymentHash && !returnedKeys.has(`${t.type}:${t.paymentHash}`),
  );
  // #896: also keep optimistic Boltz-swap placeholder rows (which have no
  // paymentHash) until the real swap leg of that direction settles.
  const swapPending = preserveOptimisticSwapRows(txs, existing, Math.floor(Date.now() / 1000));
  const carried = [...stillPending, ...swapPending];
  if (carried.length > 0) {
    txs = [...carried, ...txs].sort(
      (a, b) => (b.settled_at ?? b.created_at ?? 0) - (a.settled_at ?? a.created_at ?? 0),
    );
  }
  return txs;
}
