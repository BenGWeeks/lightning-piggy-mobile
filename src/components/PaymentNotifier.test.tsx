import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import PaymentNotifier from './PaymentNotifier';
import { firePaymentNotification } from '../services/notificationService';
import { notifyPaymentOnce } from '../services/paymentNotificationDedupe';
const mockHash = 'a'.repeat(64);
jest.mock('../contexts/WalletContext', () => ({
  useWallet: () => ({
    wallets: [{ id: 'w', transactions: [{ paymentHash: mockHash, description: 'test' }] }],
  }),
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
  await AsyncStorage.clear();
});
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
it('a foreground alert prevents a later background duplicate', async () => {
  render(<PaymentNotifier />);
  await waitFor(() => expect(firePaymentNotification).toHaveBeenCalledTimes(1));
  await notifyPaymentOnce('owner', 'w', mockHash, () =>
    firePaymentNotification({ kind: 'payment', walletId: 'w', amountSats: 123 }),
  );
  expect(firePaymentNotification).toHaveBeenCalledTimes(1);
});
