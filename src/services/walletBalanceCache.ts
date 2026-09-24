import AsyncStorage from '@react-native-async-storage/async-storage';
/** Cached balances are a startup hint; malformed or unavailable data waits for a live fetch. */
export async function readCachedWalletBalance(walletId: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(`balance_${walletId}`);
    return raw && Number.isFinite(Number(raw)) ? Number(raw) : null;
  } catch {
    return null;
  }
}
