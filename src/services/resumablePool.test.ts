import { SimplePool } from 'nostr-tools/pool';
import { withResumableSubscriptions } from './resumablePool';

class TestPool extends withResumableSubscriptions(SimplePool) {}

it('honours unsubscribe during a pending reset and suppresses old callbacks', async () => {
  let finishClose!: () => void;
  const pendingClose = new Promise<void>((resolve) => (finishClose = resolve));
  const close = jest.fn(() => pendingClose);
  const subscribe = jest.spyOn(SimplePool.prototype, 'subscribeMap').mockReturnValue({ close });
  const closeTransport = jest.spyOn(SimplePool.prototype, 'close').mockImplementation(() => {});
  const pool = new TestPool();
  const next = jest.fn();
  const onclose = jest.fn();
  const oneose = jest.fn();
  try {
    const sub = pool.subscribeMany(
      ['wss://RELAY.test:443'],
      { kinds: [1], limit: 1 },
      {
        onevent: next,
        onclose,
        oneose,
      },
    );
    const params = subscribe.mock.calls[0][1];
    const reset = pool.resetTransports(['wss://relay.test/']);
    params.onevent?.({ id: 'old' } as never);
    params.oneose?.();
    params.onclose?.(['intentional close']);
    expect(next).not.toHaveBeenCalled();
    expect(oneose).not.toHaveBeenCalled();
    expect(onclose).not.toHaveBeenCalled();
    sub.close();
    finishClose();
    await reset;
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(closeTransport).toHaveBeenCalledWith(['wss://relay.test/']);
  } finally {
    pool.destroy();
    subscribe.mockRestore();
    closeTransport.mockRestore();
  }
});
