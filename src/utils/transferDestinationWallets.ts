import type { WalletMetadata, WalletState } from '../types/wallet';
import { isExternalFundingSource } from './moveSources';

/** Scope eligible destinations to the selected profile and the next source. */
export function getTransferDestinationWallets(
  source: WalletMetadata | null,
  wallets: (WalletMetadata | WalletState)[],
  isCrossProfile: boolean,
): (WalletMetadata | WalletState)[] {
  const externalFunding = isExternalFundingSource(source);
  return wallets.filter((wallet) => {
    if (!isCrossProfile && wallet.id === source?.id) return false;
    if (isCrossProfile)
      return externalFunding
        ? wallet.walletType === 'nwc'
        : wallet.walletType === 'onchain' || wallet.walletType === 'nwc';
    const connected = 'isConnected' in wallet && wallet.isConnected;
    return externalFunding
      ? wallet.walletType === 'nwc' && connected
      : wallet.walletType === 'onchain' || connected;
  });
}

/** Preserve a valid choice; replace it only from the selected profile's list. */
export function selectTransferDestination(
  source: WalletMetadata,
  selectedId: string | null,
  wallets: (WalletMetadata | WalletState)[],
  isCrossProfile: boolean,
): string | null {
  const eligible = getTransferDestinationWallets(source, wallets, isCrossProfile);
  return eligible.find((wallet) => wallet.id === selectedId)?.id ?? eligible[0]?.id ?? null;
}
