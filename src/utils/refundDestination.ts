import { getDefaultOnchainWalletId, getWalletList } from '../services/walletStorageService';

/**
 * The on-chain wallet a failed incoming-swap refund should land in, chosen at
 * refund time (#1124): the wallet recorded when the swap was created, else the
 * default on-chain wallet, else any on-chain wallet. Null when the user has no
 * on-chain wallet yet — the refund waits until they add one.
 */
export async function resolveRefundWalletId(recorded?: string): Promise<string | null> {
  const onchain = (await getWalletList()).filter((w) => w.walletType === 'onchain');
  const has = (id: string | null | undefined): id is string =>
    !!id && onchain.some((w) => w.id === id);
  if (has(recorded)) return recorded;
  const preferred = await getDefaultOnchainWalletId();
  if (has(preferred)) return preferred;
  return onchain[0]?.id ?? null;
}
