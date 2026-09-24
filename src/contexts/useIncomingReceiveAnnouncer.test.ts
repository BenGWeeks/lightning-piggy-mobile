import { renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIncomingReceiveAnnouncer } from './useIncomingReceiveAnnouncer';
import { notifyPaymentOnce } from '../services/paymentNotificationDedupe';
import type { WalletState } from '../types/wallet';

let mockOwner: string | null = 'owner';
jest.mock('../services/walletStorageService', () => ({ getActivePubkey: () => mockOwner }));

const OLD = 'a'.repeat(64);
const NEW = 'B'.repeat(64);
const OTHER_WALLET = 'c'.repeat(64);

function wallet(id: string, txs: { hash: string; settledAt: number }[]): WalletState {
  return {
    id,
    alias: id,
    walletType: 'nwc',
    transactions: txs.map((t) => ({
      type: 'incoming',
      amount: 21,
      settled_at: t.settledAt,
      paymentHash: t.hash,
    })),
  } as unknown as WalletState;
}

function announce(wallets: WalletState[]) {
  const setLastIncomingPayment = jest.fn();
  const seenReceiptsRef = {
    current: new Map(wallets.map((w) => [w.id, new Set<string>()])),
  };
  renderHook(() =>
    useIncomingReceiveAnnouncer({
      wallets,
      seenReceiptsRef,
      persistSeenReceipts: () => {},
      setLastIncomingPayment,
    }),
  );
  return setLastIncomingPayment;
}

// Resolves once every queued claim ahead of it has settled.
const flushClaims = () => notifyPaymentOnce('flush', 'flush', 'flush', async () => 'n');

beforeEach(async () => {
  mockOwner = 'owner';
  await AsyncStorage.clear();
});

it('claims the burst receipts it does not publish, leaving the winner to PaymentNotifier', async () => {
  const publish = announce([
    wallet('w', [
      { hash: OLD, settledAt: 1 },
      { hash: NEW, settledAt: 2 },
    ]),
    wallet('w2', [{ hash: OTHER_WALLET, settledAt: 1 }]),
  ]);
  expect(publish).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls[0][0]).toEqual(expect.objectContaining({ paymentHash: NEW }));
  await flushClaims();

  // The background poll later finds all three: only the published one may
  // still alert (its claim belongs to PaymentNotifier, not the announcer).
  const send = jest.fn().mockResolvedValue('n');
  await notifyPaymentOnce('owner', 'w', OLD, send);
  await notifyPaymentOnce('owner', 'w2', OTHER_WALLET, send);
  expect(send).not.toHaveBeenCalled();
  await notifyPaymentOnce('owner', 'w', NEW.toLowerCase(), send);
  expect(send).toHaveBeenCalledTimes(1);
});

it('writes no claims without an active identity', async () => {
  mockOwner = null;
  announce([
    wallet('w', [
      { hash: OLD, settledAt: 1 },
      { hash: NEW, settledAt: 2 },
    ]),
  ]);
  await flushClaims();
  expect(await AsyncStorage.getItem('payment_notifications_v1:null:w')).toBeNull();
  expect(await AsyncStorage.getItem('payment_notifications_v1:owner:w')).toBeNull();
});
