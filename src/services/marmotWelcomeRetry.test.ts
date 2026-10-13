import * as pacing from '../contexts/nostrDecryptPacing';
import type { MarmotRumor } from './marmotSession';
import { createMemoryMarmotBackend } from './marmotStore';
import { retryApprovedWelcomes } from './marmotWelcomeRetry';

jest.mock('./localDb', () => ({ getLocalDb: jest.fn() }));

const rumor: MarmotRumor = {
  id: 'welcome',
  pubkey: 'b'.repeat(64),
  kind: 444,
  content: 'approved welcome',
  tags: [],
  created_at: 1,
};

async function setup(count = 3) {
  const backend = createMemoryMarmotBackend();
  for (let i = 0; i < count; i++) {
    await backend.set('pendingWelcomes', String(i), JSON.stringify({ ...rumor, id: String(i) }));
  }
  // Keep the real scheduler so the regression exercises actual event-loop yields.
  const create = pacing.createYieldScheduler;
  const dispose = jest.fn();
  jest.spyOn(pacing, 'createYieldScheduler').mockImplementation((opts) => {
    const scheduler = create(opts);
    return {
      ...scheduler,
      dispose: () => {
        scheduler.dispose();
        dispose();
      },
    };
  });
  return { backend, dispose };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('lets queued UI work run between multiple expensive startup joins, including a failed join', async () => {
  const { backend, dispose } = await setup();
  let now = 0;
  jest.spyOn(performance, 'now').mockImplementation(() => now);
  const events: string[] = [];
  const raf = jest.spyOn(global, 'requestAnimationFrame');
  const accept = jest.fn(async (r: MarmotRumor) => {
    events.push(`join:${r.id}`);
    now += pacing.DECRYPT_FRAME_BUDGET_MS + 1;
    setTimeout(() => events.push(`ui:${r.id}`), 0);
    if (r.id === '1') throw new Error('temporary MLS failure');
  });

  const retry = retryApprovedWelcomes(backend, () => false, accept);
  await jest.runAllTimersAsync();
  await retry;

  expect(events).toEqual(['join:0', 'ui:0', 'join:1', 'ui:1', 'join:2', 'ui:2']);
  expect(accept).toHaveBeenCalledTimes(3);
  expect(await backend.get('pendingWelcomes', '1')).not.toBeNull();
  expect(raf).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledTimes(1);
});

it('yields even for cheap joins when the safety cap is reached', async () => {
  const { backend, dispose } = await setup(10);
  jest.spyOn(performance, 'now').mockReturnValue(0);
  let uiRan = false;
  const accept = jest.fn(async (r: MarmotRumor) => {
    if (r.id === '0') setTimeout(() => (uiRan = true), 0);
    if (r.id === '9') expect(uiRan).toBe(true);
  });
  const retry = retryApprovedWelcomes(backend, () => false, accept);
  await jest.runAllTimersAsync();
  await retry;
  expect(accept).toHaveBeenCalledTimes(10);
  expect(dispose).toHaveBeenCalledTimes(1);
});

it('stops before the next join when the session retires during a yield and disposes', async () => {
  const { backend, dispose } = await setup();
  let now = 0;
  let stopped = false;
  jest.spyOn(performance, 'now').mockImplementation(() => now);
  const accept = jest.fn(async () => {
    now += pacing.DECRYPT_FRAME_BUDGET_MS + 1;
    setTimeout(() => (stopped = true), 0);
  });
  const retry = retryApprovedWelcomes(backend, () => stopped, accept);
  await jest.runAllTimersAsync();
  await retry;
  expect(accept).toHaveBeenCalledTimes(1);
  expect(dispose).toHaveBeenCalledTimes(1);
});

it('disposes when already stopped', async () => {
  const { backend, dispose } = await setup();
  const accept = jest.fn();
  await retryApprovedWelcomes(backend, () => true, accept);
  expect(accept).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledTimes(1);
});

it('disposes when reading pending Welcomes fails', async () => {
  const { backend, dispose } = await setup();
  jest.spyOn(backend, 'keys').mockRejectedValue(new Error('storage unavailable'));
  await expect(retryApprovedWelcomes(backend, () => false, jest.fn())).rejects.toThrow(
    'storage unavailable',
  );
  expect(dispose).toHaveBeenCalledTimes(1);
});
