import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { useNostr } from '../contexts/NostrContext';
import { useAccountState } from '../contexts/useAccountState';
import {
  loadMutedSenders,
  subscribeMutedSenders,
  toggleMutedSender,
} from '../services/mutedSenders';

const EMPTY: ReadonlySet<string> = new Set();
export function useMutedSenders() {
  const { pubkey } = useNostr();
  const [mutedSenders, setMutedSenders] = useAccountState(pubkey, EMPTY);
  const [ready, setReady] = useAccountState(pubkey, false);
  useEffect(() => {
    let cancelled = false;
    let revision = 0;
    const load = () => {
      const current = ++revision;
      if (!pubkey) return;
      void loadMutedSenders(pubkey)
        .then((next) => {
          if (!cancelled && current === revision) {
            setMutedSenders(next);
            setReady(true);
          }
        })
        .catch(() => {});
    };
    load();
    const unsubscribe = subscribeMutedSenders(load);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sub = AppState.addEventListener('change', (state) => {
      clearTimeout(timer);
      if (state === 'active') timer = setTimeout(load, 3000);
    });
    return () => {
      cancelled = true;
      unsubscribe();
      sub.remove();
      clearTimeout(timer);
    };
  }, [pubkey, setMutedSenders, setReady]);
  const toggle = useCallback(
    async (sender: string) => {
      if (pubkey) await toggleMutedSender(pubkey, sender);
    },
    [pubkey],
  );
  return { mutedSenders, ready, toggle };
}
