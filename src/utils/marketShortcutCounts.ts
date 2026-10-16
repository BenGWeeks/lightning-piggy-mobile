import type { BuyerOrderEntry } from './orderThreads';
import type { ShopOrderStatus } from './shopOrderStatus';

/** Only orders with a next action belong in navigation badges. */
export function buyerActionCount(entries: readonly Pick<BuyerOrderEntry, 'status'>[]): number {
  return entries.reduce(
    (count, { status }) => count + Number(status === 'payNow' || status === 'invoiceExpired'),
    0,
  );
}

export function sellerActionCount(statuses: Iterable<ShopOrderStatus>): number {
  let count = 0;
  for (const status of statuses)
    if (status === 'needsInvoice' || status === 'invoiceExpired') count += 1;
  return count;
}
