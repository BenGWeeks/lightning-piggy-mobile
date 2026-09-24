const mockStore = new Map<string, string>();
const mockFetch = jest.fn();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));
jest.mock('./boltzService', () => ({
  claimSwap: jest.fn(),
  fetchWithTimeout: (...args: unknown[]) => mockFetch(...args),
}));
jest.mock('../components/BrandedToast', () => ({ __esModule: true, default: { show: jest.fn() } }));
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { recoverPendingSwaps } from './swapRecoveryService';
import { claimSwap } from './boltzService';
bitcoin.initEccLib(ecc);
const address = bitcoin.payments.p2tr({
  internalPubkey: ecc.pointFromScalar(new Uint8Array(32).fill(3), true)!.slice(1),
}).address!;
const refund = bitcoin.script.compile([
  new Uint8Array(32).fill(3),
  bitcoin.opcodes.OP_CHECKSIGVERIFY,
  bitcoin.script.number.encode(900144),
  bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
]);
const base = {
  id: 'recovery-reverse',
  preimage: 'ab'.repeat(32),
  claimPrivateKey: 'cd'.repeat(32),
  lockupAddress: address,
  destinationAddress: address,
  refundPublicKey: '02' + '03'.repeat(32),
  swapTree: {
    claimLeaf: { version: 0xc0, output: '51' },
    refundLeaf: { version: 0xc0, output: Buffer.from(refund).toString('hex') },
  },
};
const tx = new bitcoin.Transaction();
tx.addInput(new Uint8Array(32).fill(1), 0);
tx.addOutput(bitcoin.address.toOutputScript(address), 10000n);
beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockStore.set('boltz_swap_index', JSON.stringify([base.id]));
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      status: 'transaction.mempool',
      transaction: { id: 'untrusted-server-id', hex: tx.toHex() },
    }),
  });
  jest.mocked(claimSwap).mockResolvedValue('claim-tx');
});
it.each([false, true])(
  'passes verified transaction data and timeout to the claimant (legacy=%s)',
  async (legacy) => {
    mockStore.set(
      `boltz_swap_${base.id}`,
      JSON.stringify({
        ...base,
        ...(!legacy ? { timeoutBlockHeight: 900144, onchainAmount: 10000, claimFeeRate: 3 } : {}),
      }),
    );
    await recoverPendingSwaps();
    expect(claimSwap).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutBlockHeight: 900144, onchainAmount: 10000 }),
      { txId: tx.getId(), vout: 0, amount: 10000, txHex: tx.toHex() },
      address,
    );
    expect(mockStore.has(`boltz_swap_${base.id}`)).toBe(false);
  },
);
it('preserves recovery secrets and refuses an underfunded lockup', async () => {
  mockStore.set(
    `boltz_swap_${base.id}`,
    JSON.stringify({ ...base, timeoutBlockHeight: 900144, onchainAmount: 11000 }),
  );
  await recoverPendingSwaps();
  expect(claimSwap).not.toHaveBeenCalled();
  expect(mockStore.has(`boltz_swap_${base.id}`)).toBe(true);
});
it('preserves malformed legacy records rather than deleting claim secrets', async () => {
  mockStore.set(
    `boltz_swap_${base.id}`,
    JSON.stringify({
      ...base,
      swapTree: { ...base.swapTree, refundLeaf: { version: 0xc0, output: '51' } },
    }),
  );
  await recoverPendingSwaps();
  expect(claimSwap).not.toHaveBeenCalled();
  expect(mockStore.has(`boltz_swap_${base.id}`)).toBe(true);
});
