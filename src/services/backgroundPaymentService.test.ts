import { invalidateBackgroundPaymentScope } from './backgroundPaymentScope';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { loadIdentities } from './identitiesStore';
import { getWalletList, getNwcUrl } from './walletStorageService';
import { loadBackgroundDmEnabled } from './backgroundDmPreference';
import { firePaymentNotification, hasNotificationPermission } from './notificationService';
import { readBackgroundPayments } from './backgroundPaymentTransport';
import {
  canWatchBackgroundPayments,
  checkBackgroundPayments,
  isBackgroundPaymentWatchRunning,
  startBackgroundPaymentWatch,
  stopBackgroundPaymentWatch,
} from './backgroundPaymentService';
import { notifyPaymentOnce } from './paymentNotificationDedupe';
jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  AppState: { currentState: 'background' },
}));
jest.mock('./identitiesStore', () => ({ loadIdentities: jest.fn() }));
jest.mock('./walletStorageService', () => ({ getWalletList: jest.fn(), getNwcUrl: jest.fn() }));
jest.mock('./backgroundDmPreference', () => ({ loadBackgroundDmEnabled: jest.fn() }));
jest.mock('./notificationService', () => ({
  firePaymentNotification: jest.fn(),
  hasNotificationPermission: jest.fn(),
}));
jest.mock('./backgroundPaymentTransport', () => ({ readBackgroundPayments: jest.fn() }));
const owner = 'a'.repeat(64);
const tx = {
  type: 'incoming',
  state: 'settled',
  amount: 1234000,
  settled_at: 1000,
  created_at: 1,
  payment_hash: 'b'.repeat(64),
};
const read = jest.mocked(readBackgroundPayments);
const fire = jest.mocked(firePaymentNotification);
const check = () => checkBackgroundPayments(new AbortController().signal);
beforeEach(async () => {
  jest.useFakeTimers({ now: 1_000_000 });
  jest.clearAllMocks();
  await AsyncStorage.clear();
  AppState.currentState = 'background';
  jest.mocked(loadIdentities).mockResolvedValue({ activePubkey: owner, identities: [] });
  jest.mocked(getWalletList).mockResolvedValue([{ id: 'w', walletType: 'nwc' }] as never);
  jest.mocked(getNwcUrl).mockResolvedValue('nwc-secret');
  jest.mocked(loadBackgroundDmEnabled).mockResolvedValue(true);
  jest.mocked(hasNotificationPermission).mockResolvedValue(true);
  fire.mockResolvedValue('notification');
  read.mockResolvedValue([tx] as never);
});
afterEach(() => {
  stopBackgroundPaymentWatch();
  jest.useRealTimers();
});
it('posts settled payments in sats and deduplicates against foreground delivery and later scans', async () => {
  await check();
  await check();
  await notifyPaymentOnce(owner, 'w', tx.payment_hash, () =>
    fire({ kind: 'payment', amountSats: 1234 }),
  );
  expect(fire).toHaveBeenCalledTimes(1);
  expect(fire).toHaveBeenCalledWith({ kind: 'payment', walletId: 'w', amountSats: 1234 });
});
it('does not announce existing history, outgoing, unpaid, failed, or malformed transactions', async () => {
  read.mockResolvedValue([
    { ...tx, settled_at: 999 },
    { ...tx, type: 'outgoing' },
    { ...tx, settled_at: 0 },
    { ...tx, state: 'failed' },
    { ...tx, amount: -1 },
    { ...tx, payment_hash: '' },
  ] as never);
  await check();
  expect(fire).not.toHaveBeenCalled();
});
it('primes while foregrounded, then catches an old invoice newly settled in the background', async () => {
  AppState.currentState = 'active';
  await check();
  expect(read).not.toHaveBeenCalled();
  AppState.currentState = 'background';
  jest.setSystemTime(1_060_000);
  await check();
  expect(fire).toHaveBeenCalledTimes(1);
});
it.each(['account', 'removed', 'disabled', 'aborted', 'credential'])(
  'discards a response after %s changes in flight',
  async (change) => {
    const controller = new AbortController();
    read.mockImplementationOnce(async () => {
      if (change === 'account')
        jest.mocked(loadIdentities).mockResolvedValue({ activePubkey: 'other', identities: [] });
      if (change === 'removed') jest.mocked(getWalletList).mockResolvedValue([]);
      if (change === 'disabled') jest.mocked(loadBackgroundDmEnabled).mockResolvedValue(false);
      if (change === 'aborted') controller.abort();
      if (change === 'credential') jest.mocked(getNwcUrl).mockResolvedValue('replacement');
      return [tx] as never;
    });
    await checkBackgroundPayments(controller.signal);
    expect(fire).not.toHaveBeenCalled();
  },
);
it.each(['account', 'credential', 'removed'])(
  'discards remaining deliveries after %s changes between two transactions',
  async (change) => {
    // The preflight after the read passes; the change lands while the FIRST
    // transaction is being delivered, so the SECOND must be re-validated
    // (Copilot review, #1100).
    const second = { ...tx, payment_hash: 'c'.repeat(64) };
    read.mockResolvedValue([tx, second] as never);
    fire.mockImplementationOnce(async () => {
      if (change === 'account')
        jest.mocked(loadIdentities).mockResolvedValue({ activePubkey: 'other', identities: [] });
      if (change === 'credential') jest.mocked(getNwcUrl).mockResolvedValue('replacement');
      if (change === 'removed') jest.mocked(getWalletList).mockResolvedValue([]);
      return 'notification';
    });
    await check();
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith({ kind: 'payment', walletId: 'w', amountSats: 1234 });
  },
);
it('is watchable only when opted in, permitted, and the identity owns an NWC wallet', async () => {
  expect(await canWatchBackgroundPayments()).toBe(true);
  jest.mocked(getWalletList).mockResolvedValue([{ id: 'chain', walletType: 'onchain' }] as never);
  expect(await canWatchBackgroundPayments()).toBe(false);
  jest.mocked(getWalletList).mockResolvedValue([{ id: 'w', walletType: 'nwc' }] as never);
  jest.mocked(loadIdentities).mockResolvedValue({ activePubkey: null, identities: [] } as never);
  expect(await canWatchBackgroundPayments()).toBe(false);
  jest.mocked(loadIdentities).mockResolvedValue({ activePubkey: owner, identities: [] });
  jest.mocked(loadBackgroundDmEnabled).mockResolvedValue(false);
  expect(await canWatchBackgroundPayments()).toBe(false);
  expect(read).not.toHaveBeenCalled();
});
it('reports whether the polling loop is running', () => {
  expect(isBackgroundPaymentWatchRunning()).toBe(false);
  startBackgroundPaymentWatch();
  expect(isBackgroundPaymentWatchRunning()).toBe(true);
  stopBackgroundPaymentWatch();
  expect(isBackgroundPaymentWatchRunning()).toBe(false);
});
it('isolates failed wallets and skips on-chain wallets', async () => {
  jest.mocked(getWalletList).mockResolvedValue([
    { id: 'bad', walletType: 'nwc' },
    { id: 'chain', walletType: 'onchain' },
    { id: 'w', walletType: 'nwc' },
  ] as never);
  read.mockRejectedValueOnce(new Error('offline'));
  await check();
  expect(read).toHaveBeenCalledTimes(2);
  expect(fire).toHaveBeenCalledTimes(1);
});
it('does not open connections without permission or opt-in', async () => {
  jest.mocked(hasNotificationPermission).mockResolvedValue(false);
  await check();
  jest.mocked(hasNotificationPermission).mockResolvedValue(true);
  jest.mocked(loadBackgroundDmEnabled).mockResolvedValue(false);
  await check();
  expect(read).not.toHaveBeenCalled();
});
it('tells the host when the scope disappears, but keeps polling while the host stays up', async () => {
  const onUnwatchable = jest.fn();
  startBackgroundPaymentWatch(onUnwatchable);
  await jest.advanceTimersByTimeAsync(0);
  expect(onUnwatchable).not.toHaveBeenCalled();
  // Last NWC wallet removed: the next pass finds nothing to watch.
  jest.mocked(getWalletList).mockResolvedValue([]);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(onUnwatchable).toHaveBeenCalledTimes(1);
  // Host chose to stay up (a DM watch is live): the loop is still alive and
  // picks a re-added wallet straight back up.
  expect(isBackgroundPaymentWatchRunning()).toBe(true);
  jest.mocked(getWalletList).mockResolvedValue([{ id: 'w', walletType: 'nwc' }] as never);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(read).toHaveBeenCalledTimes(2);
});
it('does not stack polling loops and cancels in-flight work when stopped', async () => {
  let requestSignal: AbortSignal | undefined;
  read.mockImplementation((_walletId, _url, signal) => {
    requestSignal = signal;
    return new Promise(() => {});
  });
  startBackgroundPaymentWatch();
  startBackgroundPaymentWatch();
  await jest.advanceTimersByTimeAsync(180_000);
  expect(read).toHaveBeenCalledTimes(1);
  stopBackgroundPaymentWatch();
  expect(requestSignal?.aborted).toBe(true);
});

it.each(['missing', 'unreadable'])(
  'stops a payment-only watcher when the last credential is %s',
  async (failure) => {
    const stopHost = jest.fn(() => stopBackgroundPaymentWatch());
    if (failure === 'missing') jest.mocked(getNwcUrl).mockResolvedValue(null);
    else jest.mocked(getNwcUrl).mockRejectedValue(new Error('locked'));
    expect(await canWatchBackgroundPayments()).toBe(false);
    startBackgroundPaymentWatch(stopHost);
    await jest.advanceTimersByTimeAsync(1);
    expect(stopHost).toHaveBeenCalledTimes(1);
    expect(isBackgroundPaymentWatchRunning()).toBe(false);
  },
);
it('rejects a late payment after the scope changes away and back', async () => {
  read.mockImplementationOnce(async () => {
    invalidateBackgroundPaymentScope();
    invalidateBackgroundPaymentScope();
    return [tx] as never;
  });
  await check();
  expect(fire).not.toHaveBeenCalled();
});

it('does not start a wallet request when the UI resumes during credential lookup', async () => {
  jest.mocked(getNwcUrl).mockImplementationOnce(async () => {
    AppState.currentState = 'active';
    return 'nwc-secret';
  });
  await check();
  expect(read).not.toHaveBeenCalled();
});
