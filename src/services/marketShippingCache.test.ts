import {
  cachedShippingOption,
  clearShippingOptionCache,
  resolveShippingOptions,
} from './marketShippingCache';
import { fetchShippingOptionsForDisplay } from './marketShippingService';
import type { ShippingOption } from '../utils/marketShipping';

jest.mock('./marketShippingService', () => ({
  fetchShippingOptionsForDisplay: jest.fn(),
  MAX_DISPLAY_SHIPPING_REFERENCES: 200,
}));
const fetchMock = fetchShippingOptionsForDisplay as jest.Mock;

const SELLER = 'a'.repeat(64);
const coord = (d: string) => `30406:${SELLER}:${d}`;
const option = (d: string): ShippingOption => ({
  coordinate: coord(d),
  pubkey: SELLER,
  dTag: d,
  title: d,
  baseAmount: 5,
  currency: 'GBP',
  countries: ['GB'],
  createdAt: 1,
});
const relays = ['wss://relay.example'];

beforeEach(() => {
  clearShippingOptionCache();
  fetchMock.mockReset();
});

test('resolves a whole batch in one fetch and records unpublished options as null', async () => {
  fetchMock.mockResolvedValue([option('uk')]);
  const result = await resolveShippingOptions({
    coordinates: [coord('uk'), coord('gone')],
    relays,
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0].coordinates).toEqual([coord('uk'), coord('gone')]);
  expect(result.get(coord('uk'))?.dTag).toBe('uk');
  expect(result.get(coord('gone'))).toBeNull();
});

test('serves cached answers without re-querying and fetches only the new coordinates', async () => {
  fetchMock.mockResolvedValueOnce([option('uk')]);
  await resolveShippingOptions({ coordinates: [coord('uk'), coord('gone')], relays });
  fetchMock.mockResolvedValueOnce([option('eu')]);
  const result = await resolveShippingOptions({
    coordinates: [coord('uk'), coord('gone'), coord('eu')],
    relays,
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][0].coordinates).toEqual([coord('eu')]);
  expect([...result.keys()].sort()).toEqual([coord('eu'), coord('gone'), coord('uk')].sort());
  await resolveShippingOptions({ coordinates: [coord('uk')], relays });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('expires answers (misses sooner than hits)', async () => {
  fetchMock.mockResolvedValue([option('uk')]);
  await resolveShippingOptions({ coordinates: [coord('uk'), coord('gone')], relays });
  const now = Date.now();
  expect(cachedShippingOption(coord('gone'), now + 3 * 60_000)).toBeUndefined();
  expect(cachedShippingOption(coord('uk'), now + 3 * 60_000)?.dTag).toBe('uk');
  expect(cachedShippingOption(coord('uk'), now + 11 * 60_000)).toBeUndefined();
});

test('caches nothing when the relay set fails, so the next call retries', async () => {
  fetchMock.mockRejectedValueOnce(new Error('all relays failed'));
  await expect(resolveShippingOptions({ coordinates: [coord('uk')], relays })).rejects.toThrow();
  expect(cachedShippingOption(coord('uk'))).toBeUndefined();
  fetchMock.mockResolvedValueOnce([option('uk')]);
  await resolveShippingOptions({ coordinates: [coord('uk')], relays });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("doesn't record an aborted fetch's gaps as unpublished", async () => {
  const controller = new AbortController();
  fetchMock.mockImplementation(async () => {
    controller.abort();
    return [];
  });
  await resolveShippingOptions({ coordinates: [coord('uk')], relays, signal: controller.signal });
  expect(cachedShippingOption(coord('uk'))).toBeUndefined();
});

test('does not cache references beyond the fetch cap as unpublished and retries them next focus', async () => {
  fetchMock.mockResolvedValue([]);
  const coordinates = Array.from({ length: 201 }, (_, i) => coord(`zone-${i}`));
  const first = await resolveShippingOptions({ coordinates, relays });
  expect(fetchMock.mock.calls[0][0].coordinates).toEqual(coordinates.slice(0, 200));
  expect(first.get(coordinates[200])).toBeNull();
  expect(cachedShippingOption(coordinates[199])).toBeNull();
  expect(cachedShippingOption(coordinates[200])).toBeUndefined();
  fetchMock.mockResolvedValue([option('zone-200')]);
  const second = await resolveShippingOptions({ coordinates, relays });
  expect(fetchMock.mock.calls[1][0].coordinates).toEqual([coordinates[200]]);
  expect(second.get(coordinates[200])?.countries).toEqual(['GB']);
});
