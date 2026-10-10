import { isTransactionSettled } from './transactionSettlement';
import type { WalletTransaction } from '../types/wallet';
import type { TransactionIconState } from '../components/TransactionTypeIcon';

/**
 * Whether a transaction row renders as "Pending" (grey, label "Pending").
 *
 * A row the swap badge marks `done` is NOT pending, even when the wallet has
 * yet to settle its leg: `swapIconState` only says `done` for a swap that
 * terminally finished (a recorded claim). The wallet can keep the Lightning
 * leg of a reverse swap "pending" for minutes after that — LNbits held a
 * fee reserve on the hold-invoice payment for ~8 min in #1179 — and showing
 * a grey "Pending" row with a green success tick contradicts itself. The
 * other direction holds by construction: an unsettled row the swap badge
 * doesn't mark `done` stays pending, and never carries a tick.
 */
export function isRowPending(
  tx: Pick<WalletTransaction, 'settled' | 'settled_at' | 'blockHeight'>,
  iconState: TransactionIconState | undefined,
): boolean {
  return !isTransactionSettled(tx) && iconState !== 'done';
}

/**
 * i18n key for the hint under a pending row's "Pending" label, or null.
 *
 * Unconfirmed on-chain transactions (they carry a `txid`) and forward swaps
 * (on-chain → Lightning; Boltz pays the invoice only after the lockup
 * confirms) are waiting on a Bitcoin block — normally ~10 minutes, sometimes
 * much longer. Saying so keeps a normal wait from reading as a stuck payment.
 */
export function pendingRowHintKey(tx: Pick<WalletTransaction, 'txid' | 'swapType'>): string | null {
  return tx.txid || tx.swapType === 'submarine' ? 'transactionList.awaitingConfirmation' : null;
}
