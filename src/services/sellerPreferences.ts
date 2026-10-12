import AsyncStorage from '@react-native-async-storage/async-storage';
import { SELLER_CURRENCIES, normaliseCurrency } from '../utils/marketSellerEvents';
const key = (pubkey: string) => `market-seller-currency:${pubkey}`;
/** Spec deviation: Gamma has no shop currency. This device/account default
 * stays app-side; it is never published as a collection or profile tag. */
export async function loadSellerCurrency(pubkey: string): Promise<string> {
  const currency = normaliseCurrency((await AsyncStorage.getItem(key(pubkey))) ?? 'SATS');
  return SELLER_CURRENCIES.includes(currency) ? currency : 'SATS';
}
export async function saveSellerCurrency(pubkey: string, currency: string): Promise<void> {
  await AsyncStorage.setItem(key(pubkey), normaliseCurrency(currency));
}
