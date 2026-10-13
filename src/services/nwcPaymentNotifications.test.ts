import type { NostrWebLNProvider } from '@getalby/sdk';
import { subscribePaymentSent } from './nwcPaymentNotifications';

function fixture(supported = true) {
  const close = jest.fn();
  const client = {
    getWalletServiceInfo: jest.fn(async () => ({
      notifications: supported ? ['payment_sent'] : [],
    })),
    _selectEncryptionType: jest.fn(async () => {}),
    encryptionType: 'nip44_v2',
    relayUrls: ['wss://wallet.example'],
    walletPubkey: 'wallet',
    publicKey: 'app',
    decrypt: jest.fn(async (_pubkey: string, content: string) => content),
    pool: { subscribe: jest.fn(() => ({ close })) },
  };
  return { client, close, sdkClient: client as unknown as NostrWebLNProvider['client'] };
}

it('only subscribes when payment_sent is advertised', async () => {
  const { client, sdkClient } = fixture(false);
  await subscribePaymentSent(sdkClient, 'a'.repeat(64), jest.fn(), new AbortController().signal);
  expect(client.pool.subscribe).not.toHaveBeenCalled();
});

it('bounds the encrypted subscription, matches the hash and closes it', async () => {
  const { client, sdkClient, close } = fixture();
  const accept = jest.fn();
  const controller = new AbortController();
  const hash = 'a'.repeat(64);
  const unsubscribe = await subscribePaymentSent(sdkClient, hash, accept, controller.signal);
  expect(client.pool.subscribe).toHaveBeenCalledWith(
    ['wss://wallet.example'],
    expect.objectContaining({
      kinds: [23197],
      authors: ['wallet'],
      '#p': ['app'],
      limit: 10,
      since: expect.any(Number),
    }),
    expect.any(Object),
  );
  const onevent = (
    client.pool.subscribe.mock.calls[0] as unknown as [
      unknown,
      unknown,
      { onevent: (event: { content: string }) => Promise<void> },
    ]
  )[2].onevent;
  const event = (type: string, payment_hash: string) => ({
    content: JSON.stringify({
      notification_type: type,
      notification: { payment_hash, preimage: 'b'.repeat(64) },
    }),
  });
  await onevent(event('payment_received', hash));
  await onevent(event('payment_sent', 'c'.repeat(64)));
  await onevent({ content: 'malformed' });
  expect(accept).not.toHaveBeenCalled();
  await onevent(event('payment_sent', hash.toUpperCase()));
  expect(accept).toHaveBeenCalledTimes(1);
  controller.abort();
  await onevent(event('payment_sent', hash));
  expect(accept).toHaveBeenCalledTimes(1);
  unsubscribe();
  expect(close).toHaveBeenCalledTimes(1);
});

it('does not arm a subscription after cancellation during capability discovery', async () => {
  const { client, sdkClient } = fixture();
  const controller = new AbortController();
  const subscription = subscribePaymentSent(
    sdkClient,
    'a'.repeat(64),
    jest.fn(),
    controller.signal,
  );
  controller.abort();
  await expect(subscription).rejects.toMatchObject({ name: 'AbortError' });
  expect(client.pool.subscribe).not.toHaveBeenCalled();
});
