import type React from 'react';
import { useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as nwcService from '../services/nwcService';
import * as onchainService from '../services/onchainService';
import * as swapRecoveryService from '../services/swapRecoveryService';
import { settledIncomingHashes, shouldSeedBaseline } from '../utils/incomingReceipts';
import { mapNwcTransactions, type NwcRawTransaction } from '../utils/nwcTransactions';
import { mapOnchainTransactions } from '../utils/onchainTransactions';
import type { WalletState, WalletTransaction } from '../types/wallet';

export type FetchTransactionsForWallet = (
  walletId: string,
  opts?: { force?: boolean },
) => Promise<boolean>;

interface Deps {
  walletsRef: React.MutableRefObject<WalletState[]>;
  /** Last committed tx-list JSON per wallet — the unchanged-poll fingerprint (#1014). */
  lastTxsJsonRef: React.MutableRefObject<Map<string, string>>;
  seenReceiptsRef: React.MutableRefObject<Map<string, Set<string>>>;
  resolveZapSendersRef: React.MutableRefObject<
    | ((walletId: string, opts?: { force?: boolean; isCurrent?: () => boolean }) => Promise<void>)
    | null
  >;
  updateWalletInState: (walletId: string, updates: Partial<WalletState>) => void;
  seedSeenReceipts: (walletId: string, seeded: Set<string>, persist?: boolean) => void;
  captureWalletIdentity: () => () => boolean;
}

/**
 * Fetch one wallet's transaction list, commit it to state, persist it to the
 * `txs_${walletId}` cache and kick off zap-sender resolution. Extracted from
 * `WalletContext` (over the file-size cap).
 *
 * Resolves `true` when a fresh list was fetched and committed, `false` when the
 * fetch failed or was superseded (identity switch, wallet removed). It never
 * rejects, so fire-and-forget callers stay safe; callers that schedule
 * refreshes (Home's swipe-to-load, #1281) use the result to decide whether the
 * wallet counts as freshly loaded or should be retried.
 */
export function useWalletTransactionsFetch({
  walletsRef,
  lastTxsJsonRef,
  seenReceiptsRef,
  resolveZapSendersRef,
  updateWalletInState,
  seedSeenReceipts,
  captureWalletIdentity,
}: Deps): FetchTransactionsForWallet {
  return useCallback<FetchTransactionsForWallet>(
    async (walletId, opts) => {
      // Read from walletsRef, not a captured `wallets`: this callback is
      // fired-and-forgotten by SendSheet after pay-success, so by the time the
      // awaited setTimeout resolves a closure snapshot is stale and `find()`
      // returns the old wallet — or undefined after a removal. See #123.
      const wallet = walletsRef.current.find((w) => w.id === walletId);
      if (!wallet) return false;
      // Pin the identity generation: after B → C → B the same wallet id is back
      // in state, so only the generation stops a late fetch overwriting it.
      const isCurrent = captureWalletIdentity();

      try {
        // Load swap-meta before mapping so swap legs tag on the first fetch
        // after launch (getSwapMeta is sync), not a refresh later (#895/#898).
        await swapRecoveryService.ensureSwapMetaLoaded();
        let txs: WalletTransaction[];
        if (wallet.walletType === 'onchain') {
          // Single sync for both balance + transactions (avoids double Electrum sync)
          const result = await onchainService.syncAndRefresh(walletId);
          if (!isCurrent()) return false;
          // A failed sync returns `{ ok: false, transactions: [] }` — keep the
          // cached list rather than committing (and persisting) an empty one,
          // and report failure so the caller retries.
          if (!result.ok) return false;
          if (result.balance !== null) {
            updateWalletInState(walletId, { balance: result.balance });
          }
          // mapOnchainTransactions tags Boltz swap legs by txid (#895) and
          // preserves optimistic swap placeholder rows across the refresh (#896).
          const existingOnchain =
            walletsRef.current.find((w) => w.id === walletId)?.transactions ?? [];
          txs = mapOnchainTransactions(result.transactions, existingOnchain);
        } else {
          const raw = await nwcService.listTransactions(walletId, isCurrent);
          if (!isCurrent()) return false;
          // Carries forward resolved zap-counterparties + optimistic rows the
          // server doesn't round-trip (see mapNwcTransactions).
          const existing = walletsRef.current.find((w) => w.id === walletId)?.transactions ?? [];
          txs = mapNwcTransactions(raw as NwcRawTransaction[], existing, walletId);
        }
        // Unchanged-poll skip (#1014): JSON reused as content fingerprint.
        // Identical serialisation keeps old `wallet.transactions` identity,
        // avoiding a re-render of every visible row on each 30 s poll.
        const txsJson = JSON.stringify(txs);
        const txsUnchanged = lastTxsJsonRef.current.get(walletId) === txsJson;
        if (!txsUnchanged) {
          updateWalletInState(walletId, { transactions: txs });
        }

        // First fetch for this wallet (e.g. a freshly-added NWC wallet, whose
        // history isn't loaded on connect): seed the announced-receipts baseline
        // from the *fetched* history so the detector can't announce it as new
        // (the empty-baseline race, #725 — see shouldSeedBaseline).
        if (shouldSeedBaseline(seenReceiptsRef.current.get(walletId))) {
          seedSeenReceipts(walletId, settledIncomingHashes(txs));
        }

        // Persist to AsyncStorage; ref updated after write so a failed
        // setItem lets the next poll retry rather than skip the persist.
        if (!txsUnchanged) {
          await AsyncStorage.setItem(`txs_${walletId}`, txsJson);
          if (!isCurrent()) return false;
          lastTxsJsonRef.current.set(walletId, txsJson);
        }

        // Kick off background zap sender resolution for any incoming
        // transactions that haven't been resolved yet. `force` (set by an
        // explicit pull-to-refresh) bypasses the fingerprint skip so the
        // resolver always does a full pass — see resolveZapSenders. Deferred
        // one macrotask so the resolver's `mergeResolverResults` re-render
        // burst can't land in the same event-loop tick as the
        // `updateWalletInState` commit above — that tick is where the
        // incoming-payment overlay's dismiss tap was getting queued (#828).
        // Pinned to this fetch's identity so a B → C → B hop cancels it.
        setTimeout(() => {
          if (!isCurrent()) return;
          resolveZapSendersRef
            .current?.(walletId, { force: opts?.force, isCurrent })
            ?.catch((e) => console.warn(`resolveZapSenders failed for ${walletId}:`, e));
        }, 0);
        return true;
      } catch (error) {
        console.warn(`fetchTransactions failed for ${walletId}:`, error);
        return false;
      }
    },
    // The refs are stable, so `wallets` stays out of the deps. Keeping the list
    // short means callers that capture this function (e.g. SendSheet's post-pay
    // refresh IIFE) hold onto a stable reference across renders.
    [
      walletsRef,
      lastTxsJsonRef,
      seenReceiptsRef,
      resolveZapSendersRef,
      updateWalletInState,
      seedSeenReceipts,
      captureWalletIdentity,
    ],
  );
}
