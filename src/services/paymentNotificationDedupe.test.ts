import AsyncStorage from '@react-native-async-storage/async-storage';
import { markPaymentsSeen, notifyPaymentOnce } from './paymentNotificationDedupe';
beforeEach(async () => {
  await AsyncStorage.clear();
});
it('serializes simultaneous background and foreground delivery and persists the claim', async () => {
  const send = jest.fn().mockResolvedValue('notification');
  await Promise.all([
    notifyPaymentOnce('a', 'w', 'hash', send),
    notifyPaymentOnce('a', 'w', 'hash', send),
  ]);
  expect(JSON.parse((await AsyncStorage.getItem('payment_notifications_v1:a:w'))!)).toEqual([
    'hash',
  ]);
  await notifyPaymentOnce('a', 'w', 'hash', send);
  expect(send).toHaveBeenCalledTimes(1);
});
it('allows separate wallets and identities to receive the same hash', async () => {
  const send = jest.fn().mockResolvedValue('n');
  await notifyPaymentOnce('a', 'w', 'h', send);
  await notifyPaymentOnce('b', 'w', 'h', send);
  await notifyPaymentOnce('a', 'other', 'h', send);
  expect(send).toHaveBeenCalledTimes(3);
});
it('retries a notification that the OS did not schedule', async () => {
  const send = jest.fn().mockResolvedValueOnce(null).mockResolvedValue('n');
  await notifyPaymentOnce('a', 'w', 'h', send);
  await notifyPaymentOnce('a', 'w', 'h', send);
  expect(send).toHaveBeenCalledTimes(2);
});
it('does not deliver an invalidated account or a claim that cannot be persisted', async () => {
  const send = jest.fn().mockResolvedValue('n');
  await notifyPaymentOnce('a', 'w', 'h', send, () => false);
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  await expect(notifyPaymentOnce('a', 'w', 'h', send)).rejects.toThrow('disk full');
  expect(send).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});

it('awaits an async scope check before claiming and before sending', async () => {
  const send = jest.fn().mockResolvedValue('n');
  await notifyPaymentOnce('a', 'w', 'h', send, async () => false);
  expect(send).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem('payment_notifications_v1:a:w')).toBeNull();
  // Scope flips between the claim and the send: the claim must be rolled back.
  const flip = jest.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
  await notifyPaymentOnce('a', 'w', 'h', send, flip);
  expect(send).not.toHaveBeenCalled();
  expect(JSON.parse((await AsyncStorage.getItem('payment_notifications_v1:a:w'))!)).toEqual([]);
  await notifyPaymentOnce('a', 'w', 'h', send, async () => true);
  expect(send).toHaveBeenCalledTimes(1);
});
it('honours claims stored by an earlier process', async () => {
  await AsyncStorage.setItem('payment_notifications_v1:a:w', JSON.stringify(['hash']));
  const send = jest.fn();
  await notifyPaymentOnce('a', 'w', 'hash', send);
  expect(send).not.toHaveBeenCalled();
});

it('rolls back the persisted claim when post-claim scope validation throws', async () => {
  const send = jest.fn().mockResolvedValue('notification');
  const scope = jest
    .fn()
    .mockResolvedValueOnce(true)
    .mockRejectedValueOnce(new Error('keystore locked'));
  await expect(notifyPaymentOnce('a', 'w', 'h', send, scope)).rejects.toThrow('keystore locked');
  expect(send).not.toHaveBeenCalled();
  await notifyPaymentOnce('a', 'w', 'h', send);
  expect(send).toHaveBeenCalledTimes(1);
});

it('claims foreground-seen payments so a later delivery stays silent', async () => {
  const send = jest.fn().mockResolvedValue('n');
  await markPaymentsSeen('a', 'w', ['h1', 'h2', 'h1']);
  await notifyPaymentOnce('a', 'w', 'h1', send);
  await notifyPaymentOnce('a', 'w', 'h2', send);
  await notifyPaymentOnce('a', 'w', 'h3', send);
  expect(send).toHaveBeenCalledTimes(1);
  expect(JSON.parse((await AsyncStorage.getItem('payment_notifications_v1:a:w'))!)).toEqual([
    'h1',
    'h2',
    'h3',
  ]);
});

it('does not claim seen payments for an identity that is no longer active', async () => {
  const send = jest.fn().mockResolvedValue('n');
  await markPaymentsSeen('a', 'w', ['h'], () => false);
  await notifyPaymentOnce('a', 'w', 'h', send);
  expect(send).toHaveBeenCalledTimes(1);
});
