import AsyncStorage from '@react-native-async-storage/async-storage';
import { externalSwapState, loadExternalSwaps, saveExternalSwap } from './externalSwapState';
import { fireNotification } from './notificationService';
let mockPubkey: string | null = 'alice';
jest.mock('./walletStorageService', () => ({ getActivePubkey: () => mockPubkey }));
jest.mock('../components/BrandedToast', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('./notificationService', () => ({ fireNotification: jest.fn() }));
const swap = {
  id: 's1',
  address: 'bc1qfixture',
  expectedAmount: 26001,
  timeoutBlockHeight: 100,
  refundPrivateKey: 'PRIVATE',
  claimPublicKey: 'pub',
  swapTree: {
    claimLeaf: { version: 192, output: 'claim' },
    refundLeaf: { version: 192, output: 'refund' },
  },
};
const state = () => externalSwapState(swap, 'watch', 'lightning', 25000, 'invoice', 'alice');
beforeEach(async () => {
  mockPubkey = 'alice';
  await AsyncStorage.clear();
  jest.clearAllMocks();
});
test('reopens exact funding instructions from storage without private recovery keys', async () => {
  await saveExternalSwap(state());
  const recovered = await loadExternalSwaps('watch', 'lightning');
  expect(recovered[0]).toMatchObject({
    id: 's1',
    address: 'bc1qfixture',
    expectedAmount: 26001,
    invoiceSats: 25000,
    timeoutBlockHeight: 100,
    status: 'swap.created',
  });
  expect(JSON.stringify(recovered)).not.toContain('PRIVATE');
  expect(await loadExternalSwaps('watch', 'different')).toEqual([]);
  mockPubkey = 'bob';
  expect(await loadExternalSwaps('watch', 'lightning')).toEqual([]);
});
test('concurrent live and recovery writes preserve both swaps and terminal status', async () => {
  await Promise.all([saveExternalSwap(state()), saveExternalSwap({ ...state(), id: 's2' })]);
  await saveExternalSwap({ ...state(), status: 'transaction.claimed' });
  await saveExternalSwap({ ...state(), status: 'swap.created' });
  const records = await loadExternalSwaps('watch', 'lightning');
  expect(records).toHaveLength(2);
  expect(records.find((record) => record.id === 's1')?.status).toBe('transaction.claimed');
  expect(fireNotification).toHaveBeenCalledTimes(1);
});
test('storage failure rejects funding instructions', async () => {
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('Disk full'));
  await expect(saveExternalSwap(state())).rejects.toThrow('Disk full');
  expect(await loadExternalSwaps('watch', 'lightning')).toEqual([]);
});

test('strips recovery secrets even when recovery supplies a richer object', async () => {
  await saveExternalSwap({
    ...state(),
    refundPrivateKey: 'PRIVATE',
    swapTree: { secret: true },
  } as ReturnType<typeof state>);
  expect(JSON.stringify(await loadExternalSwaps('watch', 'lightning'))).not.toContain('PRIVATE');
  expect((await loadExternalSwaps('watch', 'lightning'))[0]).not.toHaveProperty('swapTree');
});
