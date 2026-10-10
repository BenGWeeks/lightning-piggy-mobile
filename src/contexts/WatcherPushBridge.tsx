import { useEffect, useMemo } from 'react';

import { setWatcherContext, startWatcherPush } from '../services/watcherPush';
import { useNostr } from './NostrContext';
import { useWallet } from './WalletContext';

// Nothing on first paint needs it — stagger past cold start like MarmotBridge.
const START_DELAY_MS = 3_000;

/**
 * Feeds the notification-watcher registrar (src/services/watcherPush.ts) the
 * signed-in account, its relays and its NWC wallets. Renders nothing. The
 * inputs are reduced to stable keys so a balance poll (a new `wallets` array)
 * never looks like a wallet change.
 */
export function WatcherPushBridge(): null {
  const { isLoggedIn, pubkey, signerType, relays, dmInboxRelays } = useNostr();
  const { wallets, walletsHydrated } = useWallet();

  const nwcKey = useMemo(
    () =>
      wallets
        .filter((w) => w.walletType === 'nwc')
        .sort((a, b) => a.order - b.order)
        .map((w) => w.id)
        .join(' '),
    [wallets],
  );
  const readKey = useMemo(
    () =>
      relays
        .filter((r) => r.read)
        .map((r) => r.url)
        .join(' '),
    [relays],
  );
  const inboxKey = dmInboxRelays.join(' ');

  useEffect(() => {
    let stop: (() => void) | null = null;
    const timer = setTimeout(() => (stop = startWatcherPush()), START_DELAY_MS);
    return () => {
      clearTimeout(timer);
      stop?.();
    };
  }, []);

  useEffect(() => {
    // Wallets must be loaded first, or "no wallets yet" reads as "wallets removed".
    if (!isLoggedIn || !pubkey || !signerType || !walletsHydrated) {
      setWatcherContext(null);
      return;
    }
    const split = (key: string) => (key ? key.split(' ') : []);
    setWatcherContext({
      pubkey,
      signerType,
      inboxRelays: split(inboxKey),
      readRelays: split(readKey),
      nwcWalletIds: split(nwcKey),
    });
  }, [isLoggedIn, pubkey, signerType, walletsHydrated, nwcKey, readKey, inboxKey]);

  return null;
}
