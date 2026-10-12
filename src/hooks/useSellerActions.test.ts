import { act, renderHook } from '@testing-library/react-native';
import { finalizeEvent, getPublicKey, type Event } from 'nostr-tools';
import { useSellerActions, StaleRevisionError } from './useSellerActions';
import { fetchLatestRevision, publishSellerEvent } from '../services/marketSellerService';
import {
  buildShippingZoneTemplate,
  buildListingTemplate,
  coordinateOf,
} from '../utils/marketSellerEvents';
import { reduceSellerSnapshot, type SellerSnapshot } from '../utils/marketSellerSnapshot';

jest.mock('../contexts/NostrContext', () => ({ useNostr: () => mockAccount }));
jest.mock('../services/marketSellerService', () => ({
  fetchLatestRevision: jest.fn(),
  publishSellerEvent: jest.fn(),
  persistSellerSnapshot: jest.fn(),
  sellerRelays: () => ['wss://example.com'],
}));
const key = new Uint8Array(32).fill(7);
const pubkey = getPublicKey(key);
const mockSign = jest.fn(async (t) => finalizeEvent(t, key));
let mockAccount = { pubkey, relays: [], signEvent: mockSign };
const zone = { dTag: 'uk', name: 'UK', countries: ['GB'], cost: '3', currency: 'GBP' };
const oldZone = finalizeEvent({ ...buildShippingZoneTemplate(zone), created_at: 100 }, key);
const newZone = finalizeEvent(
  { ...buildShippingZoneTemplate({ ...zone, cost: '9' }), created_at: 200 },
  key,
);
const coordinate = coordinateOf(30406, pubkey, 'uk');
const snapshot: SellerSnapshot = {
  shop: null,
  zones: [],
  zoneEvents: new Map([[coordinate, newZone]]),
  listings: [],
};
const base = {
  shop: null,
  zoneCoordinates: [coordinate],
  zoneEvents: new Map([[coordinate, oldZone]]),
};
const shop = { name: 'Shop', description: '', currency: 'GBP' };
const fetched = (event: Event | null) => event;

beforeEach(() => {
  jest.clearAllMocks();
  mockAccount = { pubkey, relays: [], signEvent: mockSign };
  (fetchLatestRevision as jest.Mock).mockImplementation(async ({ kind }) =>
    fetched(kind === 30406 ? newZone : null),
  );
  (publishSellerEvent as jest.Mock).mockResolvedValue(undefined);
});

it.each(['edit', 'remove'])(
  'checks the retained zone form base before any %s mutation',
  async (action) => {
    const { result } = renderHook(() => useSellerActions(snapshot));
    await act(async () => {
      await expect(
        result.current.saveShop(shop, action === 'edit' ? [zone] : [], base),
      ).rejects.toBeInstanceOf(StaleRevisionError);
    });
    expect(mockSign).not.toHaveBeenCalled();
    expect(publishSellerEvent).not.toHaveBeenCalled();
  },
);

it('checks all zones before publishing an earlier changed zone', async () => {
  const { result } = renderHook(() => useSellerActions(snapshot));
  (fetchLatestRevision as jest.Mock).mockImplementation(async ({ dTag }) =>
    fetched(dTag === 'uk' ? newZone : null),
  );
  await act(async () => {
    await expect(
      result.current.saveShop(shop, [{ ...zone, dTag: 'new' }, zone], base),
    ).rejects.toBeInstanceOf(StaleRevisionError);
  });
  expect(mockSign).not.toHaveBeenCalled();
});

it('cancels a shop save when the account changes during revision lookup', async () => {
  let finish!: (value: ReturnType<typeof fetched>) => void;
  (fetchLatestRevision as jest.Mock).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { result, rerender } = renderHook(() => useSellerActions(snapshot));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.saveShop(shop, [], {
      shop: null,
      zoneCoordinates: [],
      zoneEvents: new Map(),
    });
  });
  mockAccount = { ...mockAccount, pubkey: getPublicKey(new Uint8Array(32).fill(8)) };
  rerender({});
  await act(async () => {
    finish(fetched(null));
    await expect(pending).rejects.toThrow('account changed');
  });
  expect(mockSign).not.toHaveBeenCalled();
  expect(publishSellerEvent).not.toHaveBeenCalled();
});

it('uses the confirmed latest zone revision when the user overwrites', async () => {
  const { result } = renderHook(() => useSellerActions(snapshot));
  await act(async () => {
    await result.current.saveShop(shop, [zone], base, { force: true });
  });
  expect(publishSellerEvent).toHaveBeenCalledTimes(2);
  expect(mockSign.mock.calls[0][0].created_at).toBeGreaterThan(newZone.created_at);
});

it.each([0, 60])(
  'recreates strictly after an address deletion %s seconds ahead of the clock',
  async (ahead) => {
    const now = Math.floor(Date.now() / 1000);
    const deletedAt = now + ahead;
    jest.spyOn(Date, 'now').mockReturnValue(now * 1000);
    try {
      const draft = {
        dTag: 'book',
        title: 'Book',
        description: 'Book',
        images: [],
        price: '21',
        currency: 'SAT',
        quantity: '1',
        categories: [],
        shipping: [],
      };
      const old = finalizeEvent(
        { ...buildListingTemplate({ draft, pubkey, nowSeconds: 100 }), created_at: 100 },
        key,
      );
      const deletion = finalizeEvent(
        {
          kind: 5,
          created_at: deletedAt,
          content: '',
          tags: [['a', coordinateOf(30402, pubkey, draft.dTag)]],
        },
        key,
      );
      (fetchLatestRevision as jest.Mock).mockResolvedValue({
        event: null,
        deletedAt,
        deletedIds: [],
      });
      const { result } = renderHook(() => useSellerActions(snapshot));
      await act(async () => {
        await expect(result.current.saveListing(draft, old)).rejects.toBeInstanceOf(
          StaleRevisionError,
        );
      });
      expect(mockSign).not.toHaveBeenCalled();
      await act(async () => {
        const recreated = await result.current.saveListing(draft, old, { force: true });
        expect(recreated.created_at).toBe(deletedAt + 1);
        expect(reduceSellerSnapshot([old, deletion, recreated], pubkey).listings).toEqual([
          recreated,
        ]);
      });
    } finally {
      jest.restoreAllMocks();
    }
  },
);

it.each(['deleted', 'older', 'newer', 'tie'])(
  'zone cleanup preserves the newest listing data when the relay revision is %s',
  async (revision) => {
    const draft = {
      dTag: 'book',
      title: 'Book',
      description: 'Updated description',
      images: [],
      price: '20',
      currency: 'GBP',
      quantity: '1',
      categories: [],
      shipping: [],
    };
    const cached = finalizeEvent(
      {
        ...buildListingTemplate({ draft, pubkey, nowSeconds: 200 }),
        created_at: 200,
        tags: [
          ['d', 'book'],
          ['price', '20', 'GBP'],
          ['shipping_option', coordinate],
        ],
      },
      key,
    );
    const returned =
      revision === 'deleted'
        ? null
        : finalizeEvent(
            {
              kind: cached.kind,
              content: 'Relay description',
              created_at: revision === 'older' ? 100 : revision === 'tie' ? 200 : 300,
              tags: [
                ['d', 'book'],
                ['price', '10', 'GBP'],
                ['shipping_option', coordinate],
              ],
            },
            key,
          );
    (fetchLatestRevision as jest.Mock).mockImplementation(async ({ kind }) =>
      kind === 30402
        ? { event: returned, deletedAt: -1, deletedIds: [] }
        : kind === 30406
          ? oldZone
          : null,
    );
    const { result } = renderHook(() => useSellerActions({ ...snapshot, listings: [cached] }));
    await act(async () => {
      await result.current.saveShop(shop, [], base);
    });
    const published = (publishSellerEvent as jest.Mock).mock.calls.map(([event]) => event as Event);
    if (!returned) {
      expect(published.map((event) => event.kind)).toEqual([5, 30405]);
    } else {
      const expected =
        cached.created_at > returned.created_at ||
        (cached.created_at === returned.created_at && cached.id < returned.id)
          ? cached
          : returned;
      expect(published.map((event) => event.kind)).toEqual([30402, 5, 30405]);
      expect(published[0].content).toBe(expected.content);
      expect(published[0].tags).toEqual(expected.tags.filter(([tag]) => tag !== 'shipping_option'));
      expect(published[0].created_at).toBeGreaterThan(expected.created_at);
    }
    expect(fetchLatestRevision).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 30402, dTag: 'book' }),
    );
  },
);
