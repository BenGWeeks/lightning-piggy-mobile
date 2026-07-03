import type { WalletTransaction } from '../types/wallet';
import type { TransactionIconState } from '../components/TransactionTypeIcon';

/**
 * Resolve the corner badge for a transaction row's Boltz-swap icon, given the
 * swap-recovery flags for that row. Pure so it can be unit-tested without the
 * component/service.
 *
 * Order matters:
 *  - non-Boltz rows get no badge;
 *  - a row currently flagged for attention (Boltz locked on-chain, claim not
 *    yet broadcast) shows 'attention';
 *  - **a recorded claim marks an OUTGOING swap 'done' even when the row's
 *    `settled_at` was never set** — that happens on the #891 ambiguous-pay
 *    path, where `pay_invoice` returned UNKNOWN so the LN leg never settled
 *    locally even though the swap completed (Boltz `invoice.settled`). Without
 *    this the row is stuck on the 'pending' clock forever despite the detail
 *    sheet's live poll showing "Finish swap → complete";
 *  - otherwise unsettled rows are 'pending' (clock); settled incoming rows are
 *    'done'; settled outgoing rows without a recorded claim stay unbadged (the
 *    LN leg can settle before the claim broadcasts, and a premature tick would
 *    mislead).
 */
export function swapIconState(
  tx: WalletTransaction,
  flags: { isBoltz: boolean; inAttention: boolean; claimed: boolean },
): TransactionIconState | undefined {
  if (!flags.isBoltz) return undefined;
  if (flags.inAttention) return 'attention';
  // Recorded claim ⇒ the swap terminally finished; trust it over a missing
  // local settled flag for outgoing (Send-to-BTC reverse) rows.
  if (tx.type === 'outgoing' && flags.claimed) return 'done';
  const settled = Boolean(tx.settled_at || tx.blockHeight);
  if (!settled) return 'pending';
  if (tx.type === 'incoming') return 'done';
  return undefined;
}
