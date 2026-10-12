import type { WalletState } from '../types/wallet';
import { isSendableWallet } from './walletCapabilities';

/** Home's cards, transactions and actions must use the same wallet snapshot.
 * Hydration is only evidence of emptiness once storage has finished reading.
 */
export function selectHomeWalletState(
  wallets: readonly WalletState[],
  activeWalletId: string | null,
  walletsHydrated: boolean,
) {
  const activeWallet = wallets.find((wallet) => wallet.id === activeWalletId) ?? null;
  const hasWallets = wallets.length > 0;
  const isReceiveDisabled = walletsHydrated && !hasWallets;
  const isSendDisabled =
    isReceiveDisabled || (activeWallet !== null && !isSendableWallet(activeWallet));
  const isTransferDisabled = walletsHydrated && wallets.length < 2;
  return {
    activeWallet,
    hasWallets,
    showWelcome: walletsHydrated && !hasWallets,
    isReceiveDisabled,
    isSendDisabled,
    isTransferDisabled,
    // A visible card must never look unavailable. Capability restrictions
    // still apply to taps; the sheets handle loading and connection errors.
    dimActions: walletsHydrated && !hasWallets,
  };
}
