import type { WalletMetadata, OnchainImportMethod } from '../types/wallet';
import { getWalletList, hasMnemonic, updateWalletList } from './walletStorageService';

/** Missing metadata is the migration marker; explicit values are never reclassified.
 * Pin writes to the captured owner and serialize the final read/write with metadata
 * edits so concurrent edits/removals are preserved. Failed checks leave metadata unset.
 */
export async function migrateLegacyOnchainWallets(
  owner: string | null,
  isCurrent: () => boolean,
): Promise<Map<string, OnchainImportMethod>> {
  const methods = new Map<string, OnchainImportMethod>();
  const persisted = new Map<string, OnchainImportMethod>();
  const wallets = await getWalletList(owner);
  for (const wallet of wallets) {
    if (!isCurrent()) return new Map();
    if (wallet.walletType !== 'onchain') continue;
    if (wallet.onchainImportMethod !== undefined) {
      persisted.set(wallet.id, wallet.onchainImportMethod);
      continue;
    }
    const method = (await hasMnemonic(wallet.id)) ? 'mnemonic' : 'xpub';
    methods.set(wallet.id, method);
  }
  if (!isCurrent()) return new Map();
  // A cancelled generation may have finished its write without updating the UI.
  // Return stored classifications too, without repeating secure reads or writes.
  if (methods.size === 0) return persisted;
  const applied = new Map<string, OnchainImportMethod>();
  await updateWalletList((latest) => {
    if (!isCurrent()) return null;
    const updated: WalletMetadata[] = latest.map((wallet) => {
      if (wallet.walletType === 'onchain' && wallet.onchainImportMethod !== undefined) {
        applied.set(wallet.id, wallet.onchainImportMethod);
        return wallet;
      }
      const method = methods.get(wallet.id);
      if (!method || wallet.walletType !== 'onchain' || wallet.onchainImportMethod !== undefined) {
        return wallet;
      }
      applied.set(wallet.id, method);
      return { ...wallet, onchainImportMethod: method };
    });
    return updated.some((wallet, index) => wallet !== latest[index]) ? updated : null;
  }, owner);
  return isCurrent() ? applied : new Map();
}
