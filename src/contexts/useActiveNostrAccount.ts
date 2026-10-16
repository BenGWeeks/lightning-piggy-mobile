import { loadAppRelayPrefs } from '../services/appRelayPrefs';
import { useCallback, useLayoutEffect, useState } from 'react';
import { reviveBuyerOrderTitles } from '../services/buyerOrderTitles';
import { setCurrentUserPubkey } from '../services/nostrActiveAccount';
import { setActivePubkeyForWalletStorage } from '../services/walletStorageService';

/** Own active identity and its synchronous DEV relay-routing mirror. */
export function useActiveNostrAccount() {
  const [pubkey, setPubkeyState] = useState<string | null>(null);
  const setPubkey = useCallback((pk: string | null) => {
    if (pk) {
      reviveBuyerOrderTitles(pk);
      void loadAppRelayPrefs(pk).catch(() => {
        /* App defaults stay disabled if preferences cannot be read. */
      });
    }
    if (__DEV__) setCurrentUserPubkey(pk);
    setPubkeyState(pk);
  }, []);
  // Release builds retain the existing before-paint publication timing.
  useLayoutEffect(() => {
    setCurrentUserPubkey(pubkey);
    setActivePubkeyForWalletStorage(pubkey);
  }, [pubkey]);
  return [pubkey, setPubkey] as const;
}
