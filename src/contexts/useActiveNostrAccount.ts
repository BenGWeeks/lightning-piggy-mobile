import { useCallback, useLayoutEffect, useState } from 'react';
import { setCurrentUserPubkey } from '../services/nostrActiveAccount';
import { setActivePubkeyForWalletStorage } from '../services/walletStorageService';

/** Own active identity and its synchronous DEV relay-routing mirror. */
export function useActiveNostrAccount() {
  const [pubkey, setPubkeyState] = useState<string | null>(null);
  const setPubkey = useCallback((pk: string | null) => {
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
