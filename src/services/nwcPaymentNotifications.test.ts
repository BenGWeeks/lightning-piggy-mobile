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

it('includes a payment settled during delayed discovery and encryption negotiation', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(100_000);
  try {
    const { client, sdkClient } = fixture();
    client.getWalletServiceInfo.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 7_000));
      return { notifications: ['payment_sent'] };
    });
    client._selectEncryptionType.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 6_000));
    });
    const hash = 'a'.repeat(64);
    const accept = jest.fn();
    const subscription = subscribePaymentSent(
      sdkClient,
      hash,
      accept,
      new AbortController().signal,
    );
    await jest.advanceTimersByTimeAsync(13_000);
    const unsubscribe = await subscription;
    const [, filter, handlers] = client.pool.subscribe.mock.calls[0] as unknown as [
      unknown,
      { since: number },
      { onevent: (event: { content: string; created_at: number }) => Promise<void> },
    ];
    expect(filter.since).toBe(95);
    // The relay only returns this setup-time settlement if the filter includes it.
    const event = {
      created_at: 101,
      content: JSON.stringify({
        notification_type: 'payment_sent',
        notification: { payment_hash: hash, preimage: 'b'.repeat(64) },
      }),
    };
    if (event.created_at >= filter.since) await handlers.onevent(event);
    expect(accept).toHaveBeenCalledTimes(1);
    unsubscribe();
  } finally {
    jest.useRealTimers();
  }
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
