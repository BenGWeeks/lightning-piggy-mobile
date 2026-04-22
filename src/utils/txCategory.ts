export type TxCategory = 'boltz' | 'onchain' | 'lightning';

interface TxLike {
  description?: string | null;
  swapId?: string;
  blockHeight?: number | null;
  txid?: string;
}

// Boltz wins over on-chain: swap claim txs carry a txid but should still
// render as Boltz.
export function getTxCategory(tx: TxLike): TxCategory {
  if (tx.swapId) return 'boltz';
  const desc = tx.description ?? '';
  if (/boltz swap/i.test(desc)) return 'boltz';
  if (/send to btc|send to bitcoin/i.test(desc)) return 'boltz';
  if (/receive from btc|receive from bitcoin/i.test(desc)) return 'boltz';
  if (tx.blockHeight != null || tx.txid) return 'onchain';
  return 'lightning';
}
