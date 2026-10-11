import { acquireMarketListingsPool } from './marketListingsPool';

jest.mock('nostr-tools/abstract-pool', () => {
  const close = jest.fn();
  return { AbstractSimplePool: jest.fn(() => ({ close })), __close: close };
});
const { AbstractSimplePool, __close: close } = jest.requireMock('nostr-tools/abstract-pool') as {
  AbstractSimplePool: jest.Mock;
  __close: jest.Mock;
};

it('only structure-checks: a bad-signature event passes the relay layer (verified later)', () => {
  const { verifyEvent } = AbstractSimplePool.mock.calls[0][0];
  expect(
    verifyEvent({
      kind: 30402,
      pubkey: 'a'.repeat(64),
      created_at: 1,
      tags: [],
      content: '',
      id: 'b'.repeat(64),
      sig: 'c'.repeat(128),
    }),
  ).toBe(true);
});

it('closes its sockets only when the last snapshot releases its lease', () => {
  const a = acquireMarketListingsPool(['wss://a.example']);
  const b = acquireMarketListingsPool(['wss://b.example']);
  a.release();
  a.release(); // idempotent
  expect(close).not.toHaveBeenCalled();
  b.release();
  expect(close).toHaveBeenCalledWith(['wss://a.example', 'wss://b.example']);
});
