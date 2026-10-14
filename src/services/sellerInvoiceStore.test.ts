import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadSellerInvoices, recordSellerInvoice, sellerInvoiceKey } from './sellerInvoiceStore';
import { resetSellerStore } from './sellerEventStore';
const OWNER = 'a'.repeat(64);
beforeEach(async () => {
  await AsyncStorage.clear();
  resetSellerStore();
});
it('keeps different buyers invoices isolated even when order IDs are identical', async () => {
  for (const buyerPubkey of ['b'.repeat(64), 'c'.repeat(64)])
    await recordSellerInvoice(OWNER, {
      buyerPubkey,
      orderId: 'same',
      walletId: buyerPubkey,
      paymentHash: 'hash',
      bolt11: 'invoice',
      amountSats: 10,
      sentAt: 100,
    });
  const invoices = await loadSellerInvoices(OWNER);
  expect(Object.keys(invoices)).toHaveLength(2);
  for (const buyer of ['b'.repeat(64), 'c'.repeat(64)])
    expect(invoices[sellerInvoiceKey(buyer, 'same')].walletId).toBe(buyer);
});
it('ignores legacy records without a buyer binding', async () => {
  await AsyncStorage.setItem(
    `market-seller-invoices:${OWNER}`,
    JSON.stringify({
      same: {
        orderId: 'same',
        walletId: 'old',
        paymentHash: 'hash',
        bolt11: 'invoice',
        amountSats: 10,
      },
    }),
  );
  expect(await loadSellerInvoices(OWNER)).toEqual({});
});
