import { buyerActionCount, sellerActionCount } from './marketShortcutCounts';
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
