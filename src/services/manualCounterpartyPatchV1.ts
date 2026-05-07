// One-shot migration: attribute three specific outgoing transactions on
// Ben's device that lost their counterparty record because signZapRequest
// silently failed before the fix in #418 / PR for #411 landed. Hardcoded
// because there's no Nostr-side data on these (no kind-9735 receipt was
// ever published), so the resolver fallback can't help — only a manual
// override can. Idempotent: gated by an AsyncStorage flag so a second
// run does nothing. Safe to delete the call-site + this file once it's
// run on the affected device.
//
// Match strategy: outgoing tx in any wallet's cache, magnitude equal to
// `amountSats`, no zapCounterparty already set. The amounts here are the
// distinct ones from the user's report — no other zap of the exact same
// magnitude existed on the day, so amount-match is unambiguous.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as nip19 from 'nostr-tools/nip19';
import * as walletStorage from './walletStorageService';
import * as zapCounterpartyStorage from './zapCounterpartyStorage';
import type { WalletTransaction } from '../types/wallet';

const PATCH_KEY = 'manual_counterparty_patch_v1_applied';

interface Patch {
  amountSats: number;
  npub: string;
  name: string;
}

const PATCHES: Patch[] = [
  {
    amountSats: 33431,
    npub: 'npub17dfg3tynlv39m0e9z8a0t558e7plet96xg9g4uu6q84caykq8jtqwdy09f',
    name: 'Isaac Weeks',
  },
  {
    amountSats: 66494,
    npub: 'npub1enuxqa5g0cggf849yqzd53nu0x28w69sk6xzpx2q4ej75r8tuz2sh9l3eu',
    name: 'Eden Weeks',
  },
  {
    amountSats: 199740,
    npub: 'npub1sfpeyr9k5jms37q4900mw9q4vze4xwhdxd4avdxjml8rqgjkre8s4lcq9l',
    name: 'Nineveh',
  },
];

export interface AppliedPatch {
  walletId: string;
  paymentHash: string;
  pubkey: string;
  npub: string;
  name: string;
}

export async function applyManualCounterpartyPatchV1(): Promise<AppliedPatch[]> {
  const applied: AppliedPatch[] = [];
  try {
    if (await AsyncStorage.getItem(PATCH_KEY)) return applied;

    const wallets = await walletStorage.getWalletList();
    const txCachesByWalletId: Record<string, WalletTransaction[]> = {};
    for (const w of wallets) {
      const raw = await AsyncStorage.getItem(`txs_${w.id}`);
      if (!raw) continue;
      try {
        txCachesByWalletId[w.id] = JSON.parse(raw);
      } catch {
        // skip corrupted cache
      }
    }

    for (const patch of PATCHES) {
      let pubkey: string;
      try {
        const decoded = nip19.decode(patch.npub);
        if (decoded.type !== 'npub') continue;
        pubkey = decoded.data;
      } catch {
        continue;
      }

      for (const [walletId, txs] of Object.entries(txCachesByWalletId)) {
        for (const tx of txs) {
          if (tx.type !== 'outgoing') continue;
          if (Math.abs(tx.amount) !== patch.amountSats) continue;
          if (tx.zapCounterparty && typeof tx.zapCounterparty === 'object') continue;
          if (!tx.paymentHash) continue;

          await zapCounterpartyStorage.recordOutgoing(tx.paymentHash, {
            pubkey,
            profile: {
              npub: patch.npub,
              name: patch.name,
              displayName: patch.name,
              picture: null,
              nip05: null,
            },
            comment: '',
            anonymous: false,
          });
          applied.push({
            walletId,
            paymentHash: tx.paymentHash,
            pubkey,
            npub: patch.npub,
            name: patch.name,
          });
        }
      }
    }

    await AsyncStorage.setItem(PATCH_KEY, '1');
    if (__DEV__) {
      console.log(`[ManualPatch] v1 applied: ${applied.length} transaction(s) attributed`);
    }
  } catch (e) {
    if (__DEV__) console.warn('[ManualPatch] v1 failed:', e);
    // Don't set the flag — let it retry on next launch
  }
  return applied;
}
