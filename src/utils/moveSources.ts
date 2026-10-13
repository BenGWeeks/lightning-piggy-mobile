import type { WalletMetadata, WalletState } from '../types/wallet';

/** Watch-only wallets fund swaps externally; they never gain Send capability. */
export function isExternalFundingSource(wallet: WalletMetadata | null): boolean {
  return wallet?.walletType === 'onchain' && wallet.onchainImportMethod !== 'mnemonic';
}

export function isMoveSource(wallet: WalletState): boolean {
  return wallet.walletType === 'onchain' || (wallet.walletType === 'nwc' && wallet.isConnected);
}
