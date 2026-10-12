import { act, renderHook } from '@testing-library/react-native';
import { finalizeEvent, getPublicKey, type Event } from 'nostr-tools';
import { useSellerActions, StaleRevisionError } from './useSellerActions';
import { fetchLatestRevision, publishSellerEvent } from '../services/marketSellerService';
import { buildShippingZoneTemplate, coordinateOf } from '../utils/marketSellerEvents';
import type { SellerSnapshot } from '../utils/marketSellerSnapshot';

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
