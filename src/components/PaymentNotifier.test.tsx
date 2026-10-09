import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import PaymentNotifier from './PaymentNotifier';
import { firePaymentNotification } from '../services/notificationService';
import { notifyPaymentOnce } from '../services/paymentNotificationDedupe';
const mockHash = 'a'.repeat(64);
type MockTx = {
  paymentHash: string;
  description: string;
  settled_at?: number;
  created_at?: number;
};
let mockWallets: { id: string; transactions: MockTx[] }[] = [
  { id: 'w', transactions: [{ paymentHash: mockHash, description: 'test' }] },
];
jest.mock('../contexts/WalletContext', () => ({
  useWallet: () => ({ wallets: mockWallets }),
  useWalletLive: () => ({
    lastIncomingPayment: { walletId: 'w', amountSats: 123, paymentHash: mockHash, at: 1 },
  }),
}));
jest.mock('../services/walletStorageService', () => ({ getActivePubkey: () => 'owner' }));
jest.mock('../services/notificationService', () => ({
  firePaymentNotification: jest.fn().mockResolvedValue('n'),
}));
beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(firePaymentNotification).mockResolvedValue('n');
  await AsyncStorage.clear();
  mockWallets = [{ id: 'w', transactions: [{ paymentHash: mockHash, description: 'test' }] }];
});
// The effect re-runs on a `wallets` change (a refresh) — hand it a fresh array.
function refreshWallets(rerender: (ui: React.ReactElement) => void) {
  mockWallets = [...mockWallets];
  rerender(<PaymentNotifier />);
}
it('reopening the app after a background alert does not post again', async () => {
  await notifyPaymentOnce('owner', 'w', mockHash, () =>
    firePaymentNotification({ kind: 'payment', walletId: 'w', amountSats: 123 }),
  );
  const { unmount } = render(<PaymentNotifier />);
  await waitFor(() =>
    expect(AsyncStorage.getItem).toHaveBeenCalledWith('payment_notifications_v1:owner:w'),
  );
  unmount();
  render(<PaymentNotifier />);
  // Wait for both queued foreground attempts to settle behind a sentinel claim.
  await notifyPaymentOnce('owner', 'w', 'sentinel', async () => 'n');
  expect(firePaymentNotification).toHaveBeenCalledTimes(1);
});
it('retries on the next wallets refresh when the OS refused the notification', async () => {
  // A null post (permission denied / scheduling failure) must not pin the
  // in-memory dedupe key for this mount (CodeRabbit review, #1100).
  jest.mocked(firePaymentNotification).mockResolvedValueOnce(null);
  const { rerender } = render(<PaymentNotifier />);
  await waitFor(() => expect(firePaymentNotification).toHaveBeenCalledTimes(1));
  await notifyPaymentOnce('owner', 'w', 'sentinel', async () => 'n');
  refreshWallets(rerender);
  await waitFor(() => expect(firePaymentNotification).toHaveBeenCalledTimes(2));
});
it('does not re-query a payment the background service already claimed', async () => {
  await notifyPaymentOnce('owner', 'w', mockHash, async () => 'n');
  const { rerender } = render(<PaymentNotifier />);
  await notifyPaymentOnce('owner', 'w', 'sentinel', async () => 'n');
  jest.mocked(AsyncStorage.getItem).mockClear();
  refreshWallets(rerender);
  // Flush the shared queue via a claim on ANOTHER wallet's key, so the
  // assertion below only sees reads the notifier itself made.
  await notifyPaymentOnce('owner', 'other', 'sentinel-2', async () => 'n');
  expect(firePaymentNotification).not.toHaveBeenCalled();
  expect(AsyncStorage.getItem).not.toHaveBeenCalledWith('payment_notifications_v1:owner:w');
});
it('a foreground alert prevents a later background duplicate', async () => {
  render(<PaymentNotifier />);
  await waitFor(() => expect(firePaymentNotification).toHaveBeenCalledTimes(1));
  await notifyPaymentOnce('owner', 'w', mockHash, () =>
    firePaymentNotification({ kind: 'payment', walletId: 'w', amountSats: 123 }),
  );
  expect(firePaymentNotification).toHaveBeenCalledTimes(1);
});
it('posts a payment that settled hours ago quietly, and a fresh one normally', async () => {
  const hoursAgo = Math.floor(Date.now() / 1000) - 3 * 3600;
  mockWallets = [
    {
      id: 'w',
      transactions: [{ paymentHash: mockHash, description: 'old', settled_at: hoursAgo }],
    },
  ];
  const { unmount } = render(<PaymentNotifier />);
  await waitFor(() => expect(firePaymentNotification).toHaveBeenCalledTimes(1));
  expect(jest.mocked(firePaymentNotification).mock.calls[0][0]).toMatchObject({ quiet: true });
  unmount();

  await AsyncStorage.clear();
  mockWallets = [
    {
      id: 'w',
      transactions: [
        { paymentHash: mockHash, description: 'new', settled_at: Math.floor(Date.now() / 1000) },
      ],
    },
  ];
  render(<PaymentNotifier />);
  await waitFor(() => expect(firePaymentNotification).toHaveBeenCalledTimes(2));
  expect(jest.mocked(firePaymentNotification).mock.calls[1][0]).toMatchObject({ quiet: false });
});

it('an invoice created long ago but with no settled_at is live, not quiet', async () => {
  const hoursAgo = Math.floor(Date.now() / 1000) - 3 * 3600;
  mockWallets = [
    {
      id: 'w',
      transactions: [{ paymentHash: mockHash, description: 'old invoice', created_at: hoursAgo }],
    },
  ];
  render(<PaymentNotifier />);
  await waitFor(() => expect(firePaymentNotification).toHaveBeenCalledTimes(1));
  expect(jest.mocked(firePaymentNotification).mock.calls[0][0]).toMatchObject({ quiet: false });
});
