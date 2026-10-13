import { AppState, type AppStateStatus } from 'react-native';
import { startPendingWelcomeRetries } from './marmotPendingWelcomes';
import { noteMarmotRelayReconnect } from './marmotRelayReconnect';
import { createMemoryMarmotBackend } from './marmotStore';
import type { MarmotRumor } from './marmotSession';

const welcome: MarmotRumor = {
  id: 'pending',
  pubkey: 'sender',
  kind: 444,
  created_at: 1,
  tags: [],
  content: 'welcome',
};
let change: (state: AppStateStatus) => void;
let stop: (() => void) | undefined;

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    change = listener;
    return { remove: jest.fn() };
  });
});
afterEach(() => {
  stop?.();
  stop = undefined;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function setup() {
  const backend = createMemoryMarmotBackend();
  const accept = jest.fn(async (): Promise<void> => undefined);
  stop = startPendingWelcomeRetries(backend, accept);
  await jest.advanceTimersByTimeAsync(0); // initial empty startup scan
  await backend.set('pendingWelcomes', welcome.id, JSON.stringify(welcome));
  return { backend, accept };
}

test('retries a pending Welcome only after the three-second resume stagger', async () => {
  const { backend, accept } = await setup();
  accept.mockImplementation(async () => backend.remove('pendingWelcomes', welcome.id));
  change('background');
  change('active');
  noteMarmotRelayReconnect(); // cannot bypass the resume stagger
  await jest.advanceTimersByTimeAsync(2_999);
  expect(accept).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect(accept).toHaveBeenCalledWith(welcome);
  expect(await backend.keys('pendingWelcomes')).toEqual([]);
});

test('reconnect triggers one pass and overlaps do not start another flight', async () => {
  const { backend, accept } = await setup();
  let release!: () => void;
  accept.mockImplementation(async () => {
    await new Promise<void>((resolve) => (release = resolve));
    await backend.remove('pendingWelcomes', welcome.id);
  });
  noteMarmotRelayReconnect();
  await jest.advanceTimersByTimeAsync(0);
  noteMarmotRelayReconnect();
  change('background');
  change('active');
  await jest.advanceTimersByTimeAsync(3_000);
  expect(accept).toHaveBeenCalledTimes(1);
  release();
  await jest.advanceTimersByTimeAsync(30_000);
  expect(accept).toHaveBeenCalledTimes(1);
});

test('bounds failed passes with backoff, including repeated reconnect signals', async () => {
  const { accept } = await setup();
  accept.mockRejectedValue(new Error('offline'));
  noteMarmotRelayReconnect();
  await jest.advanceTimersByTimeAsync(0);
  expect(accept).toHaveBeenCalledTimes(1);
  noteMarmotRelayReconnect();
  await jest.advanceTimersByTimeAsync(4_999);
  expect(accept).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(accept).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(10_000);
  expect(accept).toHaveBeenCalledTimes(3);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(accept).toHaveBeenCalledTimes(3);
});

test('background and stop cancel scheduled retries and remove reconnect listener', async () => {
  const { accept } = await setup();
  change('background');
  change('active');
  await jest.advanceTimersByTimeAsync(1_000);
  change('background');
  await jest.advanceTimersByTimeAsync(10_000);
  expect(accept).not.toHaveBeenCalled();
  change('active');
  stop?.();
  noteMarmotRelayReconnect();
  await jest.advanceTimersByTimeAsync(60_000);
  expect(accept).not.toHaveBeenCalled();
});
