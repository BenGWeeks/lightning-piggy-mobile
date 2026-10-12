import { useCallback, useEffect, useMemo } from 'react';
import { useActivePubkey } from '../hooks/useActivePubkey';
import { getActivePubkey, subscribeActivePubkey } from '../services/walletStorageService';
import { deferSwapRefresh } from '../utils/swapCompletion';

/** Provider-owned timers survive sheet dismissal, but never their account or provider. */
export function useDeferredSwapRefresh() {
  const pubkey = useActivePubkey();
  const scope = useMemo(
    () => ({ pubkey, active: false, cancels: new Set<() => void>() }),
    [pubkey],
  );
  useEffect(() => {
    scope.active = true;
    const cancelAll = () => {
      scope.active = false;
      for (const cancel of scope.cancels) cancel();
      scope.cancels.clear();
    };
    const unsubscribe = subscribeActivePubkey(cancelAll);
    return () => {
      unsubscribe();
      cancelAll();
    };
  }, [scope]);
  return useCallback(
    (refresh: () => Promise<unknown>) => {
      const isCurrent = () => scope.active && getActivePubkey() === scope.pubkey;
      if (!isCurrent()) return;
      const cancel = deferSwapRefresh(async () => {
        scope.cancels.delete(cancel);
        return refresh();
      }, isCurrent);
      scope.cancels.add(cancel);
    },
    [scope],
  );
}
