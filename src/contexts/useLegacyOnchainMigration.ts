import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { WalletState } from '../types/wallet';
import { getActivePubkey } from '../services/walletStorageService';
import { migrateLegacyOnchainWallets } from '../services/migrateLegacyOnchainWallets';

/** Defer secure reads until cached cards have rendered, on startup and account reloads. */
export function useLegacyOnchainMigration(
  wallets: WalletState[],
  hydrated: boolean,
  setWallets: Dispatch<SetStateAction<WalletState[]>>,
): void {
  const owner = getActivePubkey();
  // Balance/connection updates must not cancel an in-flight classification.
  const legacyIds = JSON.stringify(
    wallets
      .filter((w) => w.walletType === 'onchain' && w.onchainImportMethod === undefined)
      .map((w) => w.id),
  );
  useEffect(() => {
    if (!hydrated || legacyIds === '[]') return;
    let cancelled = false;
    const isCurrent = () => !cancelled && getActivePubkey() === owner;
    const timer = setTimeout(() => {
      void migrateLegacyOnchainWallets(owner, isCurrent)
        .then((methods) => {
          if (!isCurrent() || methods.size === 0) return;
          setWallets((prev) =>
            !isCurrent()
              ? prev
              : prev.map((wallet) => {
                  const method = methods.get(wallet.id);
                  return method &&
                    wallet.walletType === 'onchain' &&
                    wallet.onchainImportMethod === undefined
                    ? { ...wallet, onchainImportMethod: method }
                    : wallet;
                }),
          );
        })
        .catch(() => {
          // Do not log SecureStore errors: they may contain credential details.
          console.warn('[Wallet] Legacy on-chain classification deferred until next hydration');
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [legacyIds, owner, hydrated, setWallets]);
}
