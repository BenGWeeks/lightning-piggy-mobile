import { NostrWebLNProvider } from '@getalby/sdk';
import { connect, disconnect, getBalance, isConnectionInProgress, payInvoice } from './nwcService';
import { isConnectionError } from './nwcErrors';

jest.mock('@getalby/sdk', () => ({ NostrWebLNProvider: jest.fn() }));
jest.mock('./nwcEncryption', () => ({
  pinNip04IfNoInfoEvent: jest.fn(async () => {}),
  clearEncryptionDecision: jest.fn(),
}));
jest.mock('light-bolt11-decoder', () => ({
  decode: () => ({ sections: [{ name: 'payment_hash', value: 'c'.repeat(64) }] }),
}));
const URL =
  'nostr+walletconnect://' + 'a'.repeat(64) + '?relay=wss://example.com&secret=' + 'b'.repeat(64);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function provider(balance: number) {
  return {
    enable: jest.fn(async () => {}),
    getBalance: jest.fn(async () => ({ balance })),
    lookupInvoice: jest.fn(async (): Promise<{ preimage?: string }> => ({})),
    close: jest.fn(),
    client: {
      connected: true,
      pool: undefined,
      executeNip47Request: jest.fn(async (): Promise<unknown> => ({ preimage: 'retried' })),
    },
  };
}
const old = provider(111);
const fresh = provider(222);
beforeEach(() => {
  disconnect('lifecycle');
  jest.clearAllMocks();
  old.client.connected = true;
  fresh.client.connected = true;
  old.enable.mockResolvedValue();
  old.getBalance.mockResolvedValue({ balance: 111 });
  jest
    .mocked(NostrWebLNProvider)
    .mockImplementationOnce(() => old as unknown as NostrWebLNProvider)
    .mockImplementationOnce(() => fresh as unknown as NostrWebLNProvider);
});
afterEach(() => {
  disconnect('lifecycle');
  jest.mocked(NostrWebLNProvider).mockReset();
});

it('a slow old handshake cannot replace a new provider after disconnect/reconnect', async () => {
  const slow = deferred<void>();
  old.enable.mockImplementationOnce(() => slow.promise);
  const onOldEnabled = jest.fn();
  const pending = connect('lifecycle', URL, onOldEnabled);
  disconnect('lifecycle');
  await expect(connect('lifecycle', URL)).resolves.toMatchObject({ success: true });
  slow.resolve();
  await expect(pending).resolves.toMatchObject({ success: false });
  expect(old.close).toHaveBeenCalled();
  expect(fresh.close).not.toHaveBeenCalled();
  expect(onOldEnabled).not.toHaveBeenCalled();
  await expect(getBalance('lifecycle')).resolves.toBe(222);
});
it('a slow old balance response cannot remove a newer provider for the same wallet', async () => {
  const slow = deferred<{ balance: number }>();
  const enabled = deferred<void>();
  old.getBalance.mockImplementationOnce(() => slow.promise);
  const pending = connect('lifecycle', URL, () => enabled.resolve());
  await enabled.promise;
  await expect(connect('lifecycle', URL)).resolves.toMatchObject({ success: true });
  slow.resolve({ balance: 111 });
  await expect(pending).resolves.toMatchObject({ success: false });
  expect(fresh.close).not.toHaveBeenCalled();
  await expect(getBalance('lifecycle')).resolves.toBe(222);
});
it('honors the identity generation predicate before installing a provider', async () => {
  const slow = deferred<void>();
  old.enable.mockImplementationOnce(() => slow.promise);
  let current = true;
  const onEnabled = jest.fn();
  const pending = connect('lifecycle', URL, onEnabled, () => current);
  current = false;
  slow.resolve();
  await expect(pending).resolves.toMatchObject({ success: false });
  expect(old.close).toHaveBeenCalled();
  expect(onEnabled).not.toHaveBeenCalled();
});
it('does not start an already cancelled connection', async () => {
  await expect(connect('lifecycle', URL, undefined, () => false)).resolves.toMatchObject({
    success: false,
  });
  expect(NostrWebLNProvider).not.toHaveBeenCalled();
});

it('disconnect supersedes an in-flight reconnect without replacing the new provider', async () => {
  await connect('lifecycle', URL);
  old.client.connected = false;
  const slow = deferred<void>();
  const started = deferred<void>();
  fresh.enable.mockImplementationOnce(() => {
    started.resolve();
    return slow.promise;
  });
  const pending = getBalance('lifecycle').catch(() => undefined);
  await started.promise;
  disconnect('lifecycle');
  const newest = provider(333);
  jest
    .mocked(NostrWebLNProvider)
    .mockImplementationOnce(() => newest as unknown as NostrWebLNProvider);
  await connect('lifecycle', URL);
  slow.resolve();
  await pending;
  expect(fresh.close).toHaveBeenCalled();
  expect(newest.close).not.toHaveBeenCalled();
  await expect(getBalance('lifecycle')).resolves.toBe(333);
  old.client.connected = true;
});

describe('payInvoice publish-failure reconnect races', () => {
  const PREIMAGE = 'd'.repeat(64);
  async function startAmbiguousPayment() {
    await connect('lifecycle', URL);
    old.client.executeNip47Request.mockRejectedValueOnce(new Error('failed to publish'));
    const enabling = deferred<void>();
    const started = deferred<void>();
    fresh.enable.mockImplementationOnce(() => {
      started.resolve();
      return enabling.promise;
    });
    const paying = payInvoice('lifecycle', 'lnbc1fixture');
    await started.promise;
    return { paying, enabling };
  }

  it('adopts a connect() that supersedes its reconnect and still looks up before retrying', async () => {
    const newest = provider(333);
    newest.lookupInvoice.mockResolvedValueOnce({ preimage: PREIMAGE });
    jest
      .mocked(NostrWebLNProvider)
      .mockImplementationOnce(() => newest as unknown as NostrWebLNProvider);
    const { paying, enabling } = await startAmbiguousPayment();
    expect(isConnectionInProgress('lifecycle')).toBe(true);
    await expect(connect('lifecycle', URL)).resolves.toMatchObject({ success: true });
    enabling.resolve();
    await expect(paying).resolves.toEqual({ preimage: PREIMAGE });
    expect(newest.lookupInvoice).toHaveBeenCalledWith({ paymentHash: 'c'.repeat(64) });
    expect(newest.client.executeNip47Request).not.toHaveBeenCalled();
    expect(fresh.close).toHaveBeenCalled();
    expect(newest.close).not.toHaveBeenCalled();
  });

  it('shares its reconnect with a concurrent getBalance instead of being superseded', async () => {
    fresh.lookupInvoice.mockResolvedValueOnce({ preimage: PREIMAGE });
    const { paying, enabling } = await startAmbiguousPayment();
    old.client.connected = false; // closed by the payment's reconnect
    const balance = getBalance('lifecycle');
    enabling.resolve();
    await expect(paying).resolves.toEqual({ preimage: PREIMAGE });
    await expect(balance).resolves.toBe(222);
    expect(NostrWebLNProvider).toHaveBeenCalledTimes(2);
    expect(fresh.close).not.toHaveBeenCalled();
  });

  it('reports a disconnect during the reconnect as a connection error, never a definite failure', async () => {
    const { paying, enabling } = await startAmbiguousPayment();
    disconnect('lifecycle');
    enabling.resolve();
    const error = await paying.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(isConnectionError(error)).toBe(true);
    expect(old.client.executeNip47Request).toHaveBeenCalledTimes(1);
    expect(fresh.client.executeNip47Request).not.toHaveBeenCalled();
    expect(fresh.close).toHaveBeenCalled();
  });
});

it('reconnect still succeeds when closing the dead provider throws', async () => {
  await connect('lifecycle', URL);
  old.client.connected = false;
  old.close.mockImplementationOnce(() => {
    throw new Error('already closed');
  });
  await expect(getBalance('lifecycle')).resolves.toBe(222);
  await expect(getBalance('lifecycle')).resolves.toBe(222);
  expect(NostrWebLNProvider).toHaveBeenCalledTimes(2);
});

it('reports a pending connect as in progress until its provider is installed', async () => {
  const slow = deferred<void>();
  old.enable.mockImplementationOnce(() => slow.promise);
  const pending = connect('lifecycle', URL);
  expect(isConnectionInProgress('lifecycle')).toBe(true);
  slow.resolve();
  await pending;
  expect(isConnectionInProgress('lifecycle')).toBe(false);
});
it('keeps a connect in progress until its initial balance probe finishes', async () => {
  const probe = deferred<{ balance: number }>();
  const enabled = deferred<void>();
  old.getBalance.mockImplementationOnce(() => probe.promise);
  const pending = connect('lifecycle', URL, () => enabled.resolve());
  await enabled.promise;
  // Provider installed but the probe is still out: a watchdog tick seeing
  // "not in progress" here would reconnect and discard this attempt's result.
  expect(isConnectionInProgress('lifecycle')).toBe(true);
  probe.resolve({ balance: 111 });
  await expect(pending).resolves.toEqual({ success: true, balance: 111 });
  expect(isConnectionInProgress('lifecycle')).toBe(false);
});
