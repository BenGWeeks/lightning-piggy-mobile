import type { WalletState } from '../types/wallet';
import { isSendableWallet } from './walletCapabilities';

/** Move requires a live NWC connection; signing capability matches Send. */
export function getTransferSourceWallets(wallets: WalletState[]): WalletState[] {
  return wallets.filter(
    (wallet) => isSendableWallet(wallet) && (wallet.walletType !== 'nwc' || wallet.isConnected),
  );
}
