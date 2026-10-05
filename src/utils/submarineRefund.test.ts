// Refund recovery for failed incoming swaps (#1124): the destination wallet is
// chosen at refund time, pre-timeout waits are explained instead of offering a
// Refund the network would reject, and stuck swaps notify via the OS too.
import { recoverSubmarineRefund } from './submarineRefund';
import { Alert } from '../components/BrandedAlert';
import Toast from '../components/BrandedToast';
import * as boltzService from '../services/boltzService';
import * as onchainService from '../services/onchainService';
import { fireNotification } from '../services/notificationService';
import { resolveRefundWalletId } from './refundDestination';
import type { PersistedSubmarineSwap } from '../services/swapRecoveryService';

jest.mock('../components/BrandedAlert', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('../components/BrandedToast', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../services/boltzService', () => ({
  getSubmarineSwapLockup: jest.fn(),
  refundSwap: jest.fn(),
}));
jest.mock('../services/onchainService', () => ({
  getNextReceiveAddress: jest.fn(),
  getBlockHeight: jest.fn(),
}));
jest.mock('../services/swapRecoveryService', () => ({
  unregisterPendingSubmarineSwap: jest.fn(),
}));
jest.mock('expo-secure-store', () => ({ deleteItemAsync: jest.fn() }));
jest.mock('../services/notificationService', () => ({ fireNotification: jest.fn() }));
jest.mock('./refundDestination', () => ({ resolveRefundWalletId: jest.fn() }));
jest.mock('./swapSupportText', () => ({
  swapSupportHint: jest.fn().mockResolvedValue("Contact your swap server's operator with this ID."),
}));

const alert = Alert.alert as jest.Mock;
const toast = Toast.show as jest.Mock;
const notify = fireNotification as jest.Mock;
const resolveWallet = resolveRefundWalletId as jest.Mock;
const lockup = boltzService.getSubmarineSwapLockup as jest.Mock;
const nextAddress = onchainService.getNextReceiveAddress as jest.Mock;
const height = onchainService.getBlockHeight as jest.Mock;

let n = 0;
/** A fresh swap id per test: the once-per-session guards are module state. */
function swap(over: Partial<PersistedSubmarineSwap> = {}): PersistedSubmarineSwap {
  n += 1;
  return {
    id: `swap-${n}`,
    address: 'bc1qlockup',
    expectedAmount: 32_763,
    refundPrivateKey: 'aa'.repeat(32),
    claimPublicKey: 'bb'.repeat(33),
    timeoutBlockHeight: 970_943,
    swapTree: { claimLeaf: {}, refundLeaf: {} },
    ...over,
  } as PersistedSubmarineSwap;
}

beforeEach(() => {
  jest.clearAllMocks();
  lockup.mockResolvedValue({ txId: 'lock', vout: 0, amount: 32_763 });
  nextAddress.mockResolvedValue('bc1qrefund');
  height.mockResolvedValue(971_000);
});

it('refunds into a wallet chosen now when none was recorded at swap creation', async () => {
  resolveWallet.mockResolvedValue('chain-default');
  await recoverSubmarineRefund(swap({ sourceWalletId: undefined, notifiedUnrecoverable: true }));
  expect(resolveWallet).toHaveBeenCalledWith(undefined);
  expect(nextAddress).toHaveBeenCalledWith('chain-default');
  expect(alert.mock.calls[0][0]).toBe('Swap Failed — Refund Available');
});

it('asks once per session for an on-chain wallet when there is none, via OS notification too', async () => {
  resolveWallet.mockResolvedValue(null);
  const s = swap();
  await recoverSubmarineRefund(s);
  await recoverSubmarineRefund(s);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify.mock.calls[0][0]).toMatchObject({
    kind: 'payment',
    title: 'Add an on-chain wallet for your refund',
  });
  expect(lockup).not.toHaveBeenCalled();
});

it('explains a pre-timeout wait once instead of offering a Refund that would be rejected', async () => {
  resolveWallet.mockResolvedValue('chain-a');
  height.mockResolvedValue(969_987); // 956 blocks before timeout
  const s = swap();
  await recoverSubmarineRefund(s);
  await recoverSubmarineRefund(s);
  expect(alert).toHaveBeenCalledTimes(1);
  expect(alert.mock.calls[0][0]).toBe('Refund not available yet');
  expect(alert.mock.calls[0][1]).toMatch(/block 970943 \(about 7 days from now\)/);
});

it('points an unrecoverable swap at the right support contact and notifies the OS', async () => {
  await recoverSubmarineRefund(swap({ swapTree: undefined }));
  expect(toast.mock.calls[0][0].text2).toMatch(/swap server's operator/);
  expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Swap needs attention' }));
  expect(resolveWallet).not.toHaveBeenCalled();
});
