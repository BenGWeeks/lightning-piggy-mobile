import { saveExternalSwap } from './externalSwapState';
import * as SecureStore from 'expo-secure-store';
import { createSubmarineSwapForward } from './boltzService';
import { registerPendingSubmarineSwap } from './swapRecoveryService';
import { createRecoverableSubmarineSwap } from './createRecoverableSubmarineSwap';

jest.mock('./externalSwapTracking', () => ({ trackExternalSwap: jest.fn() }));
jest.mock('./externalSwapState', () => ({
  saveExternalSwap: jest.fn(),
  externalSwapState: jest.fn((swap, source, dest, amount, invoice, owner) => ({
    id: swap.id,
    sourceWalletId: source,
    destinationWalletId: dest,
    invoiceSats: amount,
    invoice,
    ownerPubkey: owner,
    expectedAmount: swap.expectedAmount,
  })),
}));

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
}));

jest.mock('./boltzService', () => ({ createSubmarineSwapForward: jest.fn() }));
jest.mock('./swapRecoveryService', () => ({ registerPendingSubmarineSwap: jest.fn() }));
let mockActivePubkey: string | null = 'a'.repeat(64);
jest.mock('./walletStorageService', () => ({ getActivePubkey: () => mockActivePubkey }));
const quote = {
  backend: 'https://example.com/v2',
  pairHash: 'approved',
  percentage: 0.5,
  minerFee: 100,
  minAmount: 10000,
  maxAmount: 100000,
};
const swap = {
  id: 'fixture',
  address: 'address',
  expectedAmount: 101,
  timeoutBlockHeight: 900144,
  refundPrivateKey: 'key',
  claimPublicKey: 'pubkey',
  swapTree: {
    claimLeaf: { version: 192, output: 'claim' },
    refundLeaf: { version: 192, output: 'refund' },
  },
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(createSubmarineSwapForward).mockResolvedValue(swap);
  jest.mocked(SecureStore.setItemAsync).mockResolvedValue();
  jest.mocked(registerPendingSubmarineSwap).mockResolvedValue();
});
it('binds the requested amount and saves full recovery material before resolving', async () => {
  await expect(createRecoverableSubmarineSwap('invoice', 100, 'source', quote)).resolves.toBe(swap);
  expect(createSubmarineSwapForward).toHaveBeenCalledWith('invoice', 100, quote);
  const [, raw, options] = jest.mocked(SecureStore.setItemAsync).mock.calls[0];
  expect(JSON.parse(raw)).toMatchObject({ ...swap, sourceWalletId: 'source' });
  expect(options).toEqual({ keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  expect(registerPendingSubmarineSwap).toHaveBeenCalledWith('fixture');
});
it('never persists or registers an unverified swap', async () => {
  jest.mocked(createSubmarineSwapForward).mockRejectedValueOnce(new Error('Invalid swap'));
  await expect(createRecoverableSubmarineSwap('invoice', 100, 'source', quote)).rejects.toThrow(
    'Invalid swap',
  );
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  expect(registerPendingSubmarineSwap).not.toHaveBeenCalled();
});
it('does not return funding instructions when persistence fails', async () => {
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('Disk full'));
  await expect(createRecoverableSubmarineSwap('invoice', 100, 'source', quote)).rejects.toThrow(
    'Disk full',
  );
  expect(registerPendingSubmarineSwap).not.toHaveBeenCalled();
});

it('does not return funding instructions when index registration fails', async () => {
  jest.mocked(registerPendingSubmarineSwap).mockRejectedValueOnce(new Error('Index full'));
  await expect(createRecoverableSubmarineSwap('invoice', 100, 'source', quote)).rejects.toThrow(
    'Index full',
  );
});
it('records the identity that started the swap, even if it switches mid-create (#1124)', async () => {
  const initiator = 'a'.repeat(64);
  mockActivePubkey = initiator;
  jest.mocked(createSubmarineSwapForward).mockImplementationOnce(async () => {
    mockActivePubkey = 'c'.repeat(64); // user switches identity while this is in flight
    return swap;
  });
  await createRecoverableSubmarineSwap('invoice', 100, 'source', quote);
  const [, raw] = jest.mocked(SecureStore.setItemAsync).mock.calls[0];
  expect(JSON.parse(raw).ownerPubkey).toBe(initiator);
});

it('persists external funding metadata and public instructions before returning', async () => {
  mockActivePubkey = 'alice';
  await createRecoverableSubmarineSwap('invoice', 100, 'watch', quote, 'lightning');
  expect(JSON.parse(jest.mocked(SecureStore.setItemAsync).mock.calls[0][1])).toMatchObject({
    externalFunding: true,
    destinationWalletId: 'lightning',
    invoice: 'invoice',
    ownerPubkey: 'alice',
  });
  expect(saveExternalSwap).toHaveBeenCalledWith(
    expect.objectContaining({ expectedAmount: 101, destinationWalletId: 'lightning' }),
  );
});
it('does not expose external payment instructions if public state cannot be saved', async () => {
  jest.mocked(saveExternalSwap).mockRejectedValueOnce(new Error('Disk full'));
  await expect(
    createRecoverableSubmarineSwap('invoice', 100, 'watch', quote, 'lightning'),
  ).rejects.toThrow('Disk full');
});
