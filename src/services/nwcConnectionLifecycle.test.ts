import { NostrWebLNProvider } from '@getalby/sdk';
import { connect, disconnect, getBalance } from './nwcService';

jest.mock('@getalby/sdk', () => ({ NostrWebLNProvider: jest.fn() }));
jest.mock('./nwcEncryption', () => ({
  pinNip04IfNoInfoEvent: jest.fn(async () => {}),
  clearEncryptionDecision: jest.fn(),
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
    close: jest.fn(),
    client: { connected: true, pool: undefined },
  };
}
const old = provider(111);
const fresh = provider(222);
beforeEach(() => {
  disconnect('lifecycle');
  jest.clearAllMocks();
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
