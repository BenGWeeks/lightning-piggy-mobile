import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import { AppState } from 'react-native';

import * as onchainService from '../services/onchainService';
import type { WalletState } from '../types/wallet';

// On-chain incoming-payment coverage (#134). Extracted from
// WalletContext so the over-cap context doesn't grow — this is a
// self-contained polling concern (its own effect, its own cadence,
// no coupling back into the provider beyond the two callbacks passed
// in). Mirrors the NWC balance poll but on a much gentler cadence:
// Esplora / BDK Electrum syncs are an order of magnitude more
// expensive than NWC `getBalance`, so we trade detection latency for
// server politeness. Specifically:
//
//   - Foreground resume → one-shot refresh of every on-chain wallet
//     so a tx that landed while backgrounded is detected immediately
//     on return.
//   - 2-minute slow poll while the app is foregrounded → catches
//     mempool credits arriving while the user lingers on Friends /
//     Home / anywhere else. Mempool (0-conf) detection is intentional:
//     the celebration is informational, not a balance commitment, and
//     waiting 10+ min for first confirmation would defeat the "sender
//     just paid me" UX. Esplora's `mempool_stats` is already included
//     in `syncSingleAddressViaEsplora`'s balance, so 0-conf credits
//     trip the existing balance-diff detector with zero extra work.
//
// We sweep ALL on-chain wallets, not just the active one — incoming
// funds to any of the user's wallets warrant a celebration, mirroring
// the balance-diff detector's per-wallet behaviour.
const ONCHAIN_POLL_MS = 2 * 60 * 1000;

interface Params {
  // Current wallet list — read only to derive the on-chain wallet
  // count (the effect's re-arm trigger). Live reads go through
  // `walletsRef` so additions/removals mid-poll are honoured.
  wallets: WalletState[];
  // Ref to the latest wallet list; read inside the poll tick so the
  // interval doesn't need to re-arm on every balance change.
  walletsRef: MutableRefObject<WalletState[]>;
  // Commits a refreshed balance back into provider state (the same
  // callback the NWC poll uses), which trips the receive detector.
  updateWalletInState: (walletId: string, updates: Partial<WalletState>) => void;
}

export function useOnchainIncomingPoll({ wallets, walletsRef, updateWalletInState }: Params): void {
  // Track count of on-chain wallets as the dep so this effect re-arms
  // when the user adds / removes an on-chain wallet, but doesn't tear
  // down on every balance tick (the full `wallets` array would).
  const onchainWalletCount = wallets.filter((w) => w.walletType === 'onchain').length;

  useEffect(() => {
    if (onchainWalletCount === 0) return;

    // Guards against overlapping sweeps: a foreground-resume refresh
    // and the 2-minute interval (or two resumes in quick succession)
    // could otherwise kick off concurrent BDK/Electrum syncs for the
    // same wallet. If a sweep is still in flight, later triggers are
    // dropped — the next tick catches up.
    let inFlight = false;

    const refreshAll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        // Re-read through walletsRef so additions/removals between the
        // effect run and this tick are honoured without re-arming the
        // entire poll.
        const onchain = walletsRef.current.filter((w) => w.walletType === 'onchain');
        await Promise.all(
          onchain.map((w) =>
            onchainService
              .getBalance(w.id)
              .then((b) => {
                // Only commit when the balance actually changed — an
                // unchanged write still costs an AsyncStorage round-trip
                // (and needlessly re-runs the receive detector).
                if (b !== null && b !== w.balance) updateWalletInState(w.id, { balance: b });
              })
              .catch(() => {
                // Transient Electrum / Esplora failures are routine; the
                // next tick will retry. Log only in dev so we don't spam
                // production with noise from a flaky third-party service.
                if (__DEV__) console.log(`[Wallet] on-chain balance refresh failed for ${w.id}`);
              }),
          ),
        );
      } finally {
        inFlight = false;
      }
    };

    let interval: ReturnType<typeof setInterval> | null = null;
    const startPoll = () => {
      if (interval) return;
      interval = setInterval(refreshAll, ONCHAIN_POLL_MS);
    };
    const stopPoll = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    if (AppState.currentState === 'active') {
      refreshAll();
      startPoll();
    }
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        refreshAll();
        startPoll();
      } else {
        stopPoll();
      }
    });
    return () => {
      stopPoll();
      sub.remove();
    };
  }, [onchainWalletCount, walletsRef, updateWalletInState]);
}
