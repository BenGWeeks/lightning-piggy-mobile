import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { CardTheme, WalletMetadata, WalletState } from '../types/wallet';
import * as walletStorage from '../services/walletStorageService';

/** Settings and ordering persist deltas against the latest metadata under the shared queue. */
export function useWalletMetadataActions(setWallets: Dispatch<SetStateAction<WalletState[]>>) {
  const updateWalletSettings = useCallback(
    async (
      walletId: string,
      settings: {
        alias?: string;
        theme?: CardTheme;
        hideBalance?: boolean;
        lightningAddress?: string | null;
      },
    ) => {
      // Update in-memory state
      setWallets((prev) => prev.map((w) => (w.id === walletId ? { ...w, ...settings } : w)));

      // Persist metadata changes
      await walletStorage.updateWalletList((list) =>
        list.map((w) => (w.id === walletId ? { ...w, ...settings } : w)),
      );
    },
    [setWallets],
  );

  const reorderWallet = useCallback(
    async (walletId: string, direction: 'up' | 'down') => {
      let reorderedList: WalletMetadata[] | null = null;

      setWallets((prev) => {
        const sorted = [...prev].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const idx = sorted.findIndex((w) => w.id === walletId);
        if (idx < 0) return prev;
        const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= sorted.length) return prev;
        [sorted[idx], sorted[targetIdx]] = [sorted[targetIdx], sorted[idx]];
        const result = sorted.map((w, i) => ({ ...w, order: i }));
        reorderedList = result;
        return result;
      });

      // Persist only order changes, preserving metadata edited since the state snapshot.
      if (reorderedList) {
        const orders = new Map((reorderedList as WalletMetadata[]).map((w) => [w.id, w.order]));
        await walletStorage.updateWalletList((list) =>
          list.map((w) => (orders.has(w.id) ? { ...w, order: orders.get(w.id)! } : w)),
        );
      }
    },
    [setWallets],
  );

  return { updateWalletSettings, reorderWallet };
}
