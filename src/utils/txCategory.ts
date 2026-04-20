export type TxCategory = 'boltz' | 'onchain' | 'lightning';

interface TxLike {
  description?: string | null;
  swapId?: string;
  blockHeight?: number | null;
  txid?: string;
}

/**
 * Classify a transaction for icon + badging purposes. Boltz wins over
 * on-chain because swap txs carry a txid on the on-chain leg but should
 * still render as Boltz. On-chain wins over Lightning when a blockHeight
 * or txid is set.
 */
export function getTxCategory(tx: TxLike): TxCategory {
  if (tx.swapId) return 'boltz';
  const desc = tx.description ?? '';
  if (/boltz swap/i.test(desc)) return 'boltz';
  if (/send to btc|send to bitcoin/i.test(desc)) return 'boltz';
  if (/receive from btc|receive from bitcoin/i.test(desc)) return 'boltz';
  if (tx.blockHeight != null || tx.txid) return 'onchain';
  return 'lightning';
}
