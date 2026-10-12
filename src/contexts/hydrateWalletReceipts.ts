import AsyncStorage from '@react-native-async-storage/async-storage';
import { settledIncomingHashes } from '../utils/incomingReceipts';
import type { WalletTransaction } from '../types/wallet';

/** Gate the actual receipt mutation after I/O, not just its caller. */
export async function hydrateWalletReceipts(
  walletId: string,
  cachedTxs: readonly WalletTransaction[],
  seed: (id: string, hashes: Set<string>, persist?: boolean) => void,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(`seenReceipts_${walletId}`);
    if (!isCurrent()) return;
    if (raw) seed(walletId, new Set<string>(JSON.parse(raw) as string[]), false);
    else seed(walletId, settledIncomingHashes(cachedTxs));
  } catch {
    if (isCurrent()) seed(walletId, settledIncomingHashes(cachedTxs));
  }
}

// Persist a wallet's announced-receipt hashes so a payment is announced once,
// EVER — not once per JS session. The in-memory set resets on every cold start
// / Metro re-eval, and the tx cache it seeds from can be stale (missing a
// just-arrived receive), so without this a payment re-announced on reload (#653).
export function persistSeenReceipts(walletId: string, seen: ReadonlySet<string>): void {
  AsyncStorage.setItem(`seenReceipts_${walletId}`, JSON.stringify([...seen])).catch(() => {});
}
