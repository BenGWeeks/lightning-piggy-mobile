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
