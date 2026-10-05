import {
  getActivePubkey,
  getDefaultOnchainWalletId,
  getWalletList,
} from '../services/walletStorageService';

export type RefundDestination =
  | { kind: 'wallet'; walletId: string; alias: string }
  /** The swap belongs to (or may belong to) another identity — wait until it's active. */
  | { kind: 'other-identity' }
  /** The active identity owns it but has no on-chain wallet yet. */
  | { kind: 'no-wallet' };

/**
 * Where a failed incoming-swap refund should land, decided at refund time
 * (#1124). The swap index is device-wide but wallet lists are per identity, so
 * a refund must never be redirected into another identity's wallet:
 * - a swap owned by another identity waits until that identity is active;
 * - a recorded wallet is used only if it's in the active identity's list —
 *   if missing, fall back only when the swap is known to be this identity's;
 * - a legacy record with neither owner nor wallet (created before the user
 *   had an on-chain wallet) falls back within the active identity; the refund
 *   prompt names the destination so the user can decline.
 */
export async function resolveRefundDestination(swap: {
  sourceWalletId?: string;
  ownerPubkey?: string;
}): Promise<RefundDestination> {
  const active = getActivePubkey();
  if (swap.ownerPubkey && swap.ownerPubkey !== active) return { kind: 'other-identity' };
  const onchain = (await getWalletList()).filter((w) => w.walletType === 'onchain');
  const find = (id: string | null | undefined) =>
    id ? onchain.find((w) => w.id === id) : undefined;

  const recorded = find(swap.sourceWalletId);
  if (recorded) return { kind: 'wallet', walletId: recorded.id, alias: recorded.alias };
  // A recorded wallet we can't see may be another identity's — never redirect
  // unless the swap is known to belong to the active identity.
  if (swap.sourceWalletId && !swap.ownerPubkey) return { kind: 'other-identity' };

  // A failed preference read is just "no preference" — still fall back.
  const preferred = await getDefaultOnchainWalletId().catch(() => null);
  const fallback = find(preferred) ?? onchain[0];
  if (!fallback) return { kind: 'no-wallet' };
  return { kind: 'wallet', walletId: fallback.id, alias: fallback.alias };
}
