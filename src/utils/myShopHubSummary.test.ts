import { hubSummaries, type HubSummaryInput } from './myShopHubSummary';

const base: HubSummaryInput = {
  status: 'ready',
  currency: 'SATS',
  zoneCount: 0,
  collectionCount: 0,
  listingCount: 0,
  orders: { total: 0, needInvoice: 0 },
};

describe('hubSummaries', () => {
  it('reads "None yet" / "No orders yet" for a loaded, empty shop', () => {
    expect(hubSummaries(base)).toEqual({
      currencies: { key: 'market.sell.hub.currencyValue', params: { currency: 'SATS' } },
      shipping: { key: 'market.sell.hub.noneYet' },
      collections: { key: 'market.sell.hub.noneYet' },
      listings: { key: 'market.sell.hub.noneYet' },
      orders: { key: 'market.sell.hub.noOrders' },
    });
  });

  it('counts what the shop has', () => {
    const s = hubSummaries({
      ...base,
      currency: 'GBP',
      zoneCount: 2,
      collectionCount: 3,
      listingCount: 12,
      orders: { total: 4, needInvoice: 0 },
    });
    expect(s.currencies.params).toEqual({ currency: 'GBP' });
    expect(s.shipping).toEqual({ key: 'market.sell.hub.shippingCount', params: { count: 2 } });
    expect(s.collections).toEqual({
      key: 'market.sell.hub.collectionsCount',
      params: { count: 3 },
    });
    expect(s.listings).toEqual({ key: 'market.sell.hub.listingsCount', params: { count: 12 } });
    expect(s.orders).toEqual({ key: 'market.sell.hub.ordersCount', params: { count: 4 } });
  });

  it('puts orders waiting for an invoice first', () => {
    expect(hubSummaries({ ...base, orders: { total: 5, needInvoice: 2 } }).orders).toEqual({
      key: 'market.sell.hub.ordersNeedInvoice',
      params: { count: 2 },
    });
  });

  it('never claims an empty shop before a fetch completes', () => {
    const loading = hubSummaries({ ...base, status: 'loading', orders: null });
    expect(loading.shipping.key).toBe('market.sell.hub.checking');
    expect(loading.listings.key).toBe('market.sell.hub.checking');
    expect(loading.orders.key).toBe('market.sell.hub.checking');
    const failed = hubSummaries({ ...base, status: 'error' });
    expect(failed.shipping.key).toBe('market.sell.hub.unavailable');
    expect(failed.collections.key).toBe('market.sell.hub.unavailable');
  });

  it('still shows cached counts while a refresh is in flight', () => {
    expect(hubSummaries({ ...base, status: 'error', zoneCount: 1 }).shipping).toEqual({
      key: 'market.sell.hub.shippingCount',
      params: { count: 1 },
    });
  });
});
