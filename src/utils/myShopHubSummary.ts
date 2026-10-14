// The one-line live summaries on the My shop hub rows (#1534). PURE: it
// returns i18n keys and params, and the screen translates them.
//
// A count of zero only reads as "None yet" once a COMPLETED fetch proves it.
// While the shop is loading (or the fetch failed) and nothing is cached, the
// row says so instead of claiming the shop is empty.
import type { SellerFetchStatus } from './shopSellGate';

export interface HubSummary {
  key: string;
  params?: Record<string, string | number>;
}

export interface HubSummaries {
  currencies: HubSummary;
  shipping: HubSummary;
  collections: HubSummary;
  listings: HubSummary;
  orders: HubSummary;
}

export interface HubSummaryInput {
  status: SellerFetchStatus;
  currency: string;
  zoneCount: number;
  collectionCount: number;
  listingCount: number;
  /** Null while the DM store read is still in flight. */
  orders: { total: number; needInvoice: number } | null;
}

const P = 'market.sell.hub';

function counted(count: number, status: SellerFetchStatus, key: string): HubSummary {
  if (count > 0) return { key: `${P}.${key}`, params: { count } };
  if (status === 'ready') return { key: `${P}.noneYet` };
  return { key: status === 'error' ? `${P}.unavailable` : `${P}.checking` };
}

export function hubSummaries(input: HubSummaryInput): HubSummaries {
  const { status, orders } = input;
  let ordersSummary: HubSummary;
  if (!orders) ordersSummary = { key: `${P}.checking` };
  else if (orders.needInvoice > 0)
    ordersSummary = { key: `${P}.ordersNeedInvoice`, params: { count: orders.needInvoice } };
  else if (orders.total > 0)
    ordersSummary = { key: `${P}.ordersCount`, params: { count: orders.total } };
  else ordersSummary = { key: `${P}.noOrders` };
  return {
    currencies: { key: `${P}.currencyValue`, params: { currency: input.currency } },
    shipping: counted(input.zoneCount, status, 'shippingCount'),
    collections: counted(input.collectionCount, status, 'collectionsCount'),
    listings: counted(input.listingCount, status, 'listingsCount'),
    orders: ordersSummary,
  };
}
