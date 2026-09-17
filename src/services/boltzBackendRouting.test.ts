// Exercise real service routing; cryptography is covered by boltzVerify tests.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  createReverseSwap,
  createSubmarineSwapForward,
  getReverseSwapFees,
  getSubmarineSwapFees,
  getSubmarineSwapLockup,
} from './boltzService';
import { getSwapBackendForId } from './swapBackendService';
import { verifyReverseSwapInvoice } from '../utils/boltzVerify';

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
}));
jest.mock('@bitcoinerlab/secp256k1', () => ({}));
jest.mock('bip32', () => ({
  __esModule: true,
  default: () => ({
    fromSeed: () => ({ privateKey: new Uint8Array(32), publicKey: new Uint8Array(33) }),
  }),
}));
jest.mock('@scure/btc-signer/musig2.js', () => ({}));
jest.mock('bitcoinjs-lib', () => ({
  address: { toOutputScript: () => new Uint8Array(22) },
  crypto: { sha256: () => new Uint8Array(32) },
}));
jest.mock('../utils/bolt11', () => ({ amountSatsFromBolt11: () => 50000 }));
jest.mock('../utils/submarineSwapVerify', () => ({ verifySubmarineSwap: jest.fn() }));
jest.mock('./onchainService', () => ({ getBlockHeight: async () => 900000 }));
jest.mock('../utils/boltzVerify', () => ({ verifyReverseSwapInvoice: jest.fn() }));
jest.mock('../utils/lockupTx', () => ({
  extractLockupFromTxHex: () => ({ vout: 0, amount: 50000 }),
}));

const originalFetch = global.fetch;
const mockFetch = jest.fn();
beforeEach(async () => {
  jest.clearAllMocks();
  mockStore.clear();
  mockFetch.mockReset();
  await AsyncStorage.clear();
  await AsyncStorage.setItem('swap_backend_url_v1', 'https://family.example/v2');
  global.fetch = mockFetch;
});
afterAll(() => {
  global.fetch = originalFetch;
});
const quote = {
  ok: true,
  json: async () => ({ BTC: { BTC: { hash: 'quote', fees: { percentage: 0.5, minerFees: 2 } } } }),
};
const reply = (id: string) => ({
  ok: true,
  json: async () => ({ id, invoice: 'invoice', expectedAmount: 50000 }),
});

it.each(['reverse', 'submarine'])('routes %s fees to the selected server', async (direction) => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      BTC: {
        BTC: {
          hash: 'quote',
          fees: { percentage: 0.5, minerFees: 2 },
          limits: { minimal: 1, maximal: 100000 },
        },
      },
    }),
  });
  await (direction === 'reverse' ? getReverseSwapFees() : getSubmarineSwapFees());
  expect(mockFetch).toHaveBeenCalledWith(
    `https://family.example/v2/swap/${direction}`,
    expect.anything(),
  );
});
it.each(['reverse', 'submarine'])(
  'pins %s creation to its original server even if the setting changes during the request',
  async (direction) => {
    mockFetch.mockImplementationOnce(async () => {
      await AsyncStorage.setItem('swap_backend_url_v1', 'https://other.example/v2');
      return direction === 'submarine' ? quote : reply('new-swap');
    });
    mockFetch.mockResolvedValue(reply('new-swap'));
    const swap = await (direction === 'reverse'
      ? createReverseSwap('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', 50000)
      : createSubmarineSwapForward('invoice', 50000));
    expect(mockFetch).toHaveBeenCalledWith(
      `https://family.example/v2/swap/${direction}`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(await getSwapBackendForId(swap.id)).toBe('https://family.example/v2');
    expect(
      mockFetch.mock.calls.every(([url]) => url.startsWith('https://family.example/v2/')),
    ).toBe(true);
    if (direction === 'reverse') expect(verifyReverseSwapInvoice).toHaveBeenCalled();
  },
);
it('does not return a fundable swap when its server cannot be persisted', async () => {
  mockFetch.mockResolvedValueOnce(quote).mockResolvedValue(reply('new-swap'));
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('storage full'));
  await expect(createSubmarineSwapForward('invoice', 50000)).rejects.toThrow('storage full');
});
it('gets refund lockups from the original provider after the setting changes', async () => {
  mockStore.set('boltz_backend_existing', 'https://original.example/v2');
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ transactionId: 'tx', hex: 'abcd' }),
  });
  expect(await getSubmarineSwapLockup('existing', 'address')).toEqual({
    txId: 'tx',
    vout: 0,
    amount: 50000,
  });
  expect(mockFetch).toHaveBeenCalledWith(
    'https://original.example/v2/swap/submarine/existing/transaction',
    expect.anything(),
  );
});
