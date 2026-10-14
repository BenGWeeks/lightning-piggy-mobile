import { AppState, type AppStateStatus } from 'react-native';

import { KeyPackageReplenisher, KEY_PACKAGE_REPLENISH_MS } from './marmotKeyPackageReplenisher';

describe('KeyPackageReplenisher', () => {
  let change: (state: AppStateStatus) => void;
  let scheduler: KeyPackageReplenisher;
  const remove = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      change = listener;
      return { remove };
    });
  });
  afterEach(() => {
    scheduler.stop();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('coalesces notices without postponing the first deadline', async () => {
    const run = jest.fn(async () => undefined);
    scheduler = new KeyPackageReplenisher(run);
    change('active');
    scheduler.request();
    await jest.advanceTimersByTimeAsync(20_000);
    scheduler.request();
    await jest.advanceTimersByTimeAsync(9_999);
    expect(run).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('retries failures with capped exponential backoff', async () => {
    const run = jest.fn(async () => {
      throw new Error('relay offline');
    });
    scheduler = new KeyPackageReplenisher(run);
    change('active');
    scheduler.request();
    for (const delay of [30_000, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000]) {
      const count = run.mock.calls.length;
      await jest.advanceTimersByTimeAsync(delay - 1);
      expect(run).toHaveBeenCalledTimes(count);
      await jest.advanceTimersByTimeAsync(1);
      expect(run).toHaveBeenCalledTimes(count + 1);
    }
  });

  it('preserves overdue work in background, staggers resume, and cancels on stop', async () => {
    const run = jest.fn(async () => undefined);
    scheduler = new KeyPackageReplenisher(run);
    change('active');
    scheduler.request();
    change('background');
    await jest.advanceTimersByTimeAsync(KEY_PACKAGE_REPLENISH_MS * 2);
    expect(run).not.toHaveBeenCalled();
    change('active');
    await jest.advanceTimersByTimeAsync(2_999);
    expect(run).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.request();
    scheduler.stop();
    change('active');
    await jest.advanceTimersByTimeAsync(KEY_PACKAGE_REPLENISH_MS);
    expect(run).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalled();
  });
});
