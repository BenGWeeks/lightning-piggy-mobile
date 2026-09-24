/** Keep provider settlement separate from its optional settlement timestamp.
 * A creation time or preimage alone does not establish that a payment settled.
 */
export function isTransactionSettled(tx: {
  settled?: boolean;
  settled_at?: number | null;
  blockHeight?: number | null;
}): boolean {
  if (typeof tx.settled === 'boolean') return tx.settled;
  return (tx.settled_at ?? 0) > 0 || (tx.blockHeight ?? 0) > 0;
}
