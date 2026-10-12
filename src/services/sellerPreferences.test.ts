import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { buildShopTemplate } from '../utils/marketSellerTestFixtures';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadSellerCurrency, saveSellerCurrency } from './sellerPreferences';
it('keeps currency as an account-scoped app default rather than publishing a shop event', async () => {
  await saveSellerCurrency('seller-a', 'eur');
  expect(await loadSellerCurrency('seller-a')).toBe('EUR');
  expect(await loadSellerCurrency('seller-b')).toBe('SATS');
  await AsyncStorage.setItem('market-seller-currency:seller-a', 'invalid');
  expect(await loadSellerCurrency('seller-a')).toBe('SATS');
});

it('migrates a verified GBP legacy merchant before the legacy collection is removed', async () => {
  const secret = new Uint8Array(32).fill(7);
  const pubkey = getPublicKey(secret);
  const shop = finalizeEvent(
    {
      ...buildShopTemplate({
        shop: { name: 'Legacy merchant', description: '', currency: 'GBP' },
        pubkey,
        productCoordinates: [],
        zoneCoordinates: [],
      }),
      created_at: 100,
    },
    secret,
  );
  expect(await loadSellerCurrency(pubkey, shop)).toBe('GBP');
  expect(await AsyncStorage.getItem(`market-seller-currency:${pubkey}`)).toBe('GBP');
  expect(await loadSellerCurrency(pubkey, null)).toBe('GBP');
  await saveSellerCurrency(pubkey, 'EUR');
  expect(await loadSellerCurrency(pubkey, shop)).toBe('EUR');
  expect(await loadSellerCurrency('other-account', shop)).toBe('SATS');
});
