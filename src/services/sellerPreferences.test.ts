import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadSellerCurrency, saveSellerCurrency } from './sellerPreferences';
it('keeps currency as an account-scoped app default rather than publishing a shop event', async () => {
  await saveSellerCurrency('seller-a', 'eur');
  expect(await loadSellerCurrency('seller-a')).toBe('EUR');
  expect(await loadSellerCurrency('seller-b')).toBe('SATS');
  await AsyncStorage.setItem('market-seller-currency:seller-a', 'invalid');
  expect(await loadSellerCurrency('seller-a')).toBe('SATS');
});
