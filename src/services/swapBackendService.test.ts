import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  DEFAULT_SWAP_BACKEND,
  normalizeSwapBackend,
  getSwapBackend,
  checkAndSaveSwapBackend,
  pinSwapBackend,
  getSwapBackendForId,
  swapWebSocketUrl,
} from './swapBackendService';

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
}));
const originalFetch = global.fetch;
const mockFetch = jest.fn();
const pair = {
  BTC: {
    BTC: {
      hash: 'quote',
      limits: { minimal: 100, maximal: 100000 },
      fees: { percentage: 0.5, minerFees: 2 },
    },
  },
};
beforeEach(async () => {
  jest.clearAllMocks();
  mockStore.clear();
  await AsyncStorage.clear();
  mockFetch.mockReset().mockImplementation(async (url: string) => ({
    ok: true,
    json: async () =>
      url.endsWith('/reverse')
        ? {
            BTC: {
              BTC: {
                ...pair.BTC.BTC,
                fees: { percentage: 0.5, minerFees: { claim: 2, lockup: 2 } },
              },
            },
          }
        : pair,
  }));
  global.fetch = mockFetch;
});
afterAll(() => {
  global.fetch = originalFetch;
});

it.each([
  ['https://SWAPS.example/', 'https://swaps.example/v2'],
  [' https://swaps.example/v2/ ', 'https://swaps.example/v2'],
  ['https://10.0.0.1:8443/boltz', 'https://10.0.0.1:8443/boltz/v2'],
  ['https://[fd00::1]:8443/v2', 'https://[fd00::1]:8443/v2'],
])('normalizes %s', (input, expected) => {
  expect(normalizeSwapBackend(input)).toBe(expected);
});
it.each([
  '',
  'http://10.0.0.1',
  'wss://host',
  'https://user:secret@host',
  'https://host?q=x',
  'https://host#x',
  'https://host/v1',
  'https://host/v2/ws',
  'https://host\\path',
  'https://',
])('rejects %s', (input) => {
  expect(() => normalizeSwapBackend(input)).toThrow();
});
it('derives the private WebSocket URL including proxy prefix', () => {
  expect(swapWebSocketUrl('https://host:8443/boltz/v2')).toBe('wss://host:8443/boltz/v2/ws');
});
it('defaults only when no setting exists, and persists a checked server', async () => {
  expect(await getSwapBackend()).toBe(DEFAULT_SWAP_BACKEND);
  await checkAndSaveSwapBackend('https://family.example');
  expect(await getSwapBackend()).toBe('https://family.example/v2');
  expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([
    'https://family.example/v2/swap/reverse',
    'https://family.example/v2/swap/submarine',
  ]);
});
it.each(['offline', 'http', 'incompatible'])(
  'keeps the saved setting when check is %s',
  async (failure) => {
    await checkAndSaveSwapBackend('https://old.example');
    if (failure === 'offline') mockFetch.mockRejectedValue(new Error('offline'));
    if (failure === 'http') mockFetch.mockResolvedValue({ ok: false, status: 401 });
    if (failure === 'incompatible')
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    await expect(checkAndSaveSwapBackend('https://new.example')).rejects.toThrow();
    expect(await getSwapBackend()).toBe('https://old.example/v2');
  },
);
it('does not silently fall back on corrupt settings or storage errors', async () => {
  await AsyncStorage.setItem('swap_backend_url_v1', 'corrupt');
  await expect(getSwapBackend()).rejects.toThrow();
  jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('locked'));
  await expect(getSwapBackend()).rejects.toThrow('locked');
});
it('keeps existing and legacy swaps on their original server after settings change', async () => {
  await checkAndSaveSwapBackend('https://first.example');
  await pinSwapBackend('first-swap', await getSwapBackend());
  await checkAndSaveSwapBackend('https://second.example');
  await pinSwapBackend('second-swap', await getSwapBackend());
  expect(await getSwapBackendForId('first-swap')).toBe('https://first.example/v2');
  expect(await getSwapBackendForId('second-swap')).toBe('https://second.example/v2');
  expect(await getSwapBackendForId('legacy-swap')).toBe(DEFAULT_SWAP_BACKEND);
});
it('rejects simultaneous reused IDs without overwriting the original server', async () => {
  const results = await Promise.allSettled([
    pinSwapBackend('same', 'https://one.example'),
    pinSwapBackend('same', 'https://two.example'),
  ]);
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
  expect(await getSwapBackendForId('same')).toBe('https://one.example/v2');
});
it.each(['boltz_swap_', 'submarine_swap_'])('protects old recovery records: %s', async (prefix) => {
  mockStore.set(`${prefix}old`, '{}');
  await expect(pinSwapBackend('old', 'https://new.example')).rejects.toThrow('reused');
  expect(await getSwapBackendForId('old')).toBe(DEFAULT_SWAP_BACKEND);
});
it('does not proceed when pin persistence fails, and permits a later retry', async () => {
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('full'));
  await expect(pinSwapBackend('one', 'https://family.example')).rejects.toThrow('full');
  await pinSwapBackend('one', 'https://family.example');
  expect(await getSwapBackendForId('one')).toBe('https://family.example/v2');
});
it('does not redirect a swap to the public default when its pin cannot be read', async () => {
  jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('locked'));
  await expect(getSwapBackendForId('one')).rejects.toThrow('locked');
});

it.each([undefined, null, '', '../swap', 'x'.repeat(129)])(
  'rejects malformed swap IDs before persistence: %s',
  async (id) => {
    await expect(pinSwapBackend(id as string, 'https://family.example')).rejects.toThrow(
      'Invalid swap ID',
    );
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  },
);

it.each([
  ['submarine', { hash: '' }],
  ['submarine', { hash: undefined }],
  ['submarine', { fees: { percentage: 0.5 } }],
  ['submarine', { fees: { percentage: 0.5, minerFees: -1 } }],
  ['submarine', { fees: { percentage: 0.5, minerFees: 1.5 } }],
  ['reverse', { fees: { percentage: 0.5, minerFees: { claim: '100' } } }],
  ['reverse', { fees: { percentage: 0.5, minerFees: {} } }],
])('does not save an unusable %s quote (%j)', async (direction, fields) => {
  await checkAndSaveSwapBackend('https://old.example');
  mockFetch.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () =>
      url.endsWith(`/${direction}`) ? { BTC: { BTC: { ...pair.BTC.BTC, ...fields } } } : pair,
  }));
  await expect(checkAndSaveSwapBackend('https://new.example')).rejects.toThrow('fee quote');
  expect(await getSwapBackend()).toBe('https://old.example/v2');
});
it('accepts reverse object miner fees and submarine integer miner fees', async () => {
  mockFetch.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () =>
      url.endsWith('/reverse')
        ? {
            BTC: {
              BTC: {
                ...pair.BTC.BTC,
                fees: { percentage: 0.5, minerFees: { claim: 100, lockup: 150 } },
              },
            },
          }
        : pair,
  }));
  await expect(checkAndSaveSwapBackend('https://valid.example')).resolves.toBe(
    'https://valid.example/v2',
  );
});
