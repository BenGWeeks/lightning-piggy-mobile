// Exercise real service routing; cryptography is covered by boltzVerify tests.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  createReverseSwap,
  createSubmarineSwapForward,
  getReverseSwapFees,
  getSubmarineSwapFees,
  getSubmarineSwapLockup,
  isQuoteChangedError,
  QuoteChangedError,
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
jest.mock('../utils/reverseSwapVerify', () => ({ verifyReverseSwap: jest.fn() }));
jest.mock('../utils/submarineSwapVerify', () => ({ verifySubmarineSwap: jest.fn() }));
jest.mock('./onchainService', () => ({
  getBlockHeight: async () => 900000,
  getSwapClaimFeeRate: async () => 2,
}));
jest.mock('../utils/boltzVerify', () => ({ verifyReverseSwapInvoice: jest.fn() }));
jest.mock('../utils/lockupTx', () => ({
  extractLockupFromTxHex: () => ({ txId: 'tx', vout: 0, amount: 50000 }),
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
  json: async () => ({
    BTC: {
      BTC: {
        hash: 'quote',
        limits: { minimal: 1, maximal: 100000 },
        fees: { percentage: 0.5, minerFees: { claim: 2, lockup: 2 } },
      },
    },
  }),
};
const reply = (id: string) => ({
  ok: true,
  json: async () => ({
    id,
    invoice: 'invoice',
    expectedAmount: 50000,
    refundPublicKey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    claimPublicKey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  }),
});

it.each(['reverse', 'submarine'])('routes %s fees to the selected server', async (direction) => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      BTC: {
        BTC: {
          hash: 'quote',
          fees: {
            percentage: 0.5,
            minerFees: direction === 'reverse' ? { claim: 2, lockup: 2 } : 2,
          },
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
      return direction === 'submarine'
        ? {
            ...quote,
            json: async () => ({
              BTC: {
                BTC: {
                  hash: 'quote',
                  limits: { minimal: 1, maximal: 100000 },
                  fees: { percentage: 0.5, minerFees: 2 },
                },
              },
            }),
          }
        : quote;
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
it('rejects a stale approved reverse quote with the refreshed quote before creating a swap', async () => {
  mockFetch.mockResolvedValueOnce(quote);
  const approved = await getReverseSwapFees();
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      BTC: {
        BTC: {
          hash: 'requoted',
          limits: { minimal: 1, maximal: 100000 },
          fees: { percentage: 1, minerFees: { claim: 2, lockup: 5 } },
        },
      },
    }),
  });
  const error = await createReverseSwap(
    'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    50000,
    approved,
  ).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(QuoteChangedError);
  expect(isQuoteChangedError(error)).toBe(true);
  expect((error as QuoteChangedError).quote).toEqual(
    expect.objectContaining({
      pairHash: 'requoted',
      percentage: 1,
      lockupMinerFee: 5,
      backend: 'https://family.example/v2',
    }),
  );
  // Only the two quote GETs — the swap was never created.
  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(mockFetch).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ method: 'POST' }),
  );
});
it('does not classify other swap errors as a changed quote', () => {
  expect(isQuoteChangedError(new Error('Swap fees or server changed.'))).toBe(false);
});
it('does not return a fundable swap when its server cannot be persisted', async () => {
  mockFetch
    .mockResolvedValueOnce({
      ...quote,
      json: async () => ({
        BTC: {
          BTC: {
            hash: 'quote',
            limits: { minimal: 1, maximal: 100000 },
            fees: { percentage: 0.5, minerFees: 2 },
          },
        },
      }),
    })
    .mockResolvedValue(reply('new-swap'));
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
it('refuses a refund lockup whose advertised txid disagrees with the returned hex', async () => {
  // The mocked hex parses to txid `tx`; the server advertises another one.
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ transactionId: 'attacker-tx', hex: 'abcd' }),
  });
  expect(await getSubmarineSwapLockup('existing', 'address')).toBeNull();
});
it('takes the refund lockup txid from the hex when none is advertised', async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ hex: 'abcd' }) });
  expect(await getSubmarineSwapLockup('existing', 'address')).toEqual({
    txId: 'tx',
    vout: 0,
    amount: 50000,
  });
});

it('surfaces pinned-provider storage errors instead of reporting an absent refund', async () => {
  jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('keystore locked'));
  await expect(getSubmarineSwapLockup('swap', 'address')).rejects.toThrow('keystore locked');
});
