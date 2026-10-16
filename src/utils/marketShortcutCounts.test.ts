import { buyerActionCount, sellerActionCount, hasOwnMarketListings } from './marketShortcutCounts';
import type { BuyerOrderStatus } from './orderThreads';
import type { ShopOrderStatus } from './shopOrderStatus';

it('counts unpaid and expired buyer invoices, excluding waiting, paid and terminal orders', () => {
  const statuses: BuyerOrderStatus[] = [
    'payNow',
    'invoiceExpired',
    'awaitingInvoice',
    'paid',
    'shipped',
    'completed',
    'cancelled',
    'payNow',
  ];
  expect(buyerActionCount(statuses.map((status) => ({ status })))).toBe(3);
});

it('counts seller invoices needing creation or replacement, excluding sent, paid and terminal orders', () => {
  const statuses: ShopOrderStatus[] = [
    'needsInvoice',
    'invoiceExpired',
    'invoiceSent',
    'paid',
    'shipped',
    'cancelled',
    'needsInvoice',
  ];
  expect(sellerActionCount(statuses)).toBe(3);
});

it('returns zero for empty snapshots and snapshots without actions', () => {
  expect(buyerActionCount([])).toBe(0);
  expect(sellerActionCount([])).toBe(0);
  expect(buyerActionCount([{ status: 'paid' }])).toBe(0);
  expect(sellerActionCount(['invoiceSent'])).toBe(0);
});

it('recognises an own kind-30402 listing even before the seller snapshot loads', () => {
  const pubkey = 'a'.repeat(64);
  const marketEvents = [{ kind: 30402, pubkey }];
  expect(hasOwnMarketListings(pubkey, [...[], ...marketEvents])).toBe(true);
  expect(hasOwnMarketListings(pubkey.toUpperCase(), marketEvents)).toBe(true);
  expect(hasOwnMarketListings('b'.repeat(64), marketEvents)).toBe(false);
  expect(hasOwnMarketListings(null, marketEvents)).toBe(false);
  expect(hasOwnMarketListings(pubkey, [{ kind: 30017, pubkey }])).toBe(false);
  expect(hasOwnMarketListings(pubkey, [])).toBe(false);
});
