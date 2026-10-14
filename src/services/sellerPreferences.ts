import type { Event } from 'nostr-tools';
import { isLegacyShopCollection } from '../utils/marketCollections';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SELLER_CURRENCIES, normaliseCurrency } from '../utils/marketSellerEvents';
const key = (pubkey: string) => `market-seller-currency:${pubkey}`;
/** Spec deviation: Gamma has no shop currency. This device/account default
 * stays app-side; it is never published as a collection or profile tag. */
export async function loadSellerCurrency(
  pubkey: string,
  legacyShop?: Event | null,
): Promise<string> {
  const stored = await AsyncStorage.getItem(key(pubkey));
  const legacy =
    legacyShop?.pubkey === pubkey && isLegacyShopCollection(legacyShop)
      ? legacyShop.tags.find((t) => t[0] === 'currency')?.[1]
      : undefined;
  const currency = normaliseCurrency(stored ?? legacy ?? 'SATS');
  if (stored === null && legacy && SELLER_CURRENCIES.includes(currency)) {
    await saveSellerCurrency(pubkey, currency);
  }
  return SELLER_CURRENCIES.includes(currency) ? currency : 'SATS';
}
const listeners = new Set<(pubkey: string) => void>();
/** Fires after a currency save, so every open seller screen re-reads it. */
export function subscribeSellerCurrency(listener: (pubkey: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export async function saveSellerCurrency(pubkey: string, currency: string): Promise<void> {
  await AsyncStorage.setItem(key(pubkey), normaliseCurrency(currency));
  for (const listener of listeners) listener(pubkey);
}
