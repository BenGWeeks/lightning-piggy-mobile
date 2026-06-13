import { deferPostPaymentRefresh, type InteractionScheduler } from './deferPostPaymentRefresh';

// A controllable fake of InteractionManager: it captures the queued task
// instead of running it, so a test can assert the refresh is scheduled
// off the interaction path (deferred) rather than run synchronously —
// the core guarantee of #859 / #828 (the overlay dismiss is never gated
// behind the refresh).
function makeFakeScheduler() {
  const tasks: (() => void)[] = [];
  let cancelled = 0;
  const scheduler: InteractionScheduler = {
    runAfterInteractions(task: () => void) {
      tasks.push(task);
      return {
        cancel() {
          cancelled += 1;
        },
      };
    },
  };
  return {
    scheduler,
    runQueued: () => tasks.forEach((t) => t()),
    pendingCount: () => tasks.length,
    cancelledCount: () => cancelled,
  };
}

describe('deferPostPaymentRefresh', () => {
  it('does NOT run the refresh synchronously — it schedules it after interactions', () => {
    const refresh = jest.fn();
    const fake = makeFakeScheduler();

    deferPostPaymentRefresh(refresh, fake.scheduler);

    // The dismiss tap path is never blocked: nothing ran inline.
    expect(refresh).not.toHaveBeenCalled();
    expect(fake.pendingCount()).toBe(1);
  });

  it('runs the refresh once the interaction frame settles', () => {
    const refresh = jest.fn();
    const fake = makeFakeScheduler();

    deferPostPaymentRefresh(refresh, fake.scheduler);
    fake.runQueued();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('cancel() drops a not-yet-run refresh (effect cleanup / unmount)', () => {
    const refresh = jest.fn();
    const fake = makeFakeScheduler();

    const handle = deferPostPaymentRefresh(refresh, fake.scheduler);
    handle.cancel();

    expect(fake.cancelledCount()).toBe(1);
  });

  it('swallows a synchronous throw from the refresh so the UI cannot crash', () => {
    const refresh = jest.fn(() => {
      throw new Error('refresh boom');
    });
    const fake = makeFakeScheduler();

    deferPostPaymentRefresh(refresh, fake.scheduler);

    expect(() => fake.runQueued()).not.toThrow();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('swallows a rejected promise from an async refresh', async () => {
    const refresh = jest.fn(() => Promise.reject(new Error('async boom')));
    const fake = makeFakeScheduler();

    deferPostPaymentRefresh(refresh, fake.scheduler);
    fake.runQueued();

    // Give the rejected promise a tick to settle; no unhandled rejection.
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('defaults to the real InteractionManager when no scheduler is passed', () => {
    const refresh = jest.fn();
    // Should not throw and should return a handle with cancel().
    const handle = deferPostPaymentRefresh(refresh);
    expect(typeof handle.cancel).toBe('function');
    handle.cancel();
  });
});
