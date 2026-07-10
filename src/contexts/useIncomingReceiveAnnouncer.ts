import { useEffect } from 'react';
import type { MutableRefObject } from 'react';

import {
  pickNewReceipts,
  pickNewerReceipt,
  shouldSeedBaseline,
  type AnnouncedReceipt,
} from '../utils/incomingReceipts';
import { walletLabel, type WalletState } from '../types/wallet';
import { incomingPaymentSourceFor } from './incomingPaymentSource';
import type { IncomingPayment } from './WalletContext';

interface Params {
  wallets: WalletState[];
  // The per-wallet set of already-announced payment hashes. A wallet
  // absent from the map has no baseline yet and is skipped (baselining
  // is owned by the seeding sites — #725).
  seenReceiptsRef: MutableRefObject<Map<string, Set<string>>>;
  // Persist a wallet's seen-set so a reload before the next write can't
  // re-announce a payment.
  persistSeenReceipts: (walletId: string, seen: ReadonlySet<string>) => void;
  // Publishes the single winning receipt to the global overlay.
  setLastIncomingPayment: (payment: IncomingPayment) => void;
}

// Receive detector. Announces each settled incoming payment exactly once,
// keyed by payment_hash — so a flapping / stale balance can't re-announce the
// same payment (#653). A wallet with no baseline yet is skipped: baselining is
// owned by the seeding sites (launch hydration, identity switch, first fetch),
// never off the in-state txns here — see #725 + shouldSeedBaseline. Extracted
// from WalletContext (over-cap) into its own hook; #134 threads `source`
// through so the overlay can show an on-chain mempool-pending hint.
export function useIncomingReceiveAnnouncer({
  wallets,
  seenReceiptsRef,
  persistSeenReceipts,
  setLastIncomingPayment,
}: Params): void {
  useEffect(() => {
    // Mark every new receipt seen (so none re-announces on a later refresh), but
    // announce only ONE per render: the overlay shows a single payment and
    // setLastIncomingPayment is one state value — calling it in a loop would
    // batch and keep only the last, dropping the rest (#655 review). Pick the
    // newest by settled_at, deterministically, across all wallets.
    let newest: AnnouncedReceipt | null = null;
    for (const wallet of wallets) {
      const txns = wallet.transactions ?? [];
      const seen = seenReceiptsRef.current.get(wallet.id);
      // No baseline yet — skip. Baselining is owned by the seeding sites (launch
      // hydration, identity switch, first fetch); doing it here off the current
      // in-state txns re-introduces the empty-baseline race (#725, see
      // shouldSeedBaseline).
      if (shouldSeedBaseline(seen)) continue;
      let changed = false;
      for (const receipt of pickNewReceipts(txns, seen)) {
        seen.add(receipt.paymentHash);
        changed = true;
        newest = pickNewerReceipt(newest, {
          ...receipt,
          walletId: wallet.id,
          walletLabel: walletLabel(wallet),
          // Which rail delivered this credit (#134) — on-chain receives carry
          // the mempool/confirmation hint; everything else is Lightning.
          source: incomingPaymentSourceFor(wallet.walletType),
        });
      }
      // Persist the moment a new receipt is seen so a reload before the next
      // write can't re-announce it.
      if (changed) persistSeenReceipts(wallet.id, seen);
    }
    if (newest) {
      if (__DEV__)
        console.log(
          `[Wallet] incoming payment detected: +${newest.amountSats} sats on ${newest.walletLabel} (${newest.paymentHash.slice(0, 12)}…)`,
        );
      setLastIncomingPayment({
        walletId: newest.walletId,
        amountSats: newest.amountSats,
        at: Date.now(),
        paymentHash: newest.paymentHash,
        // Rail that delivered the credit (#134); the detector always tags it,
        // default to lightning defensively.
        source: newest.source ?? 'lightning',
        // Already detected from a current tx list — skip the redundant refresh.
        fromTxList: true,
      });
    }
  }, [wallets, seenReceiptsRef, persistSeenReceipts, setLastIncomingPayment]);
}
