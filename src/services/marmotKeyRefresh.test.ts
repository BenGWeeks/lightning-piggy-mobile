import { KeyPackageRefreshRequests } from './marmotKeyRefresh';

describe('KeyPackageRefreshRequests', () => {
  afterEach(() => jest.useRealTimers());

  test('a run forces a publish only when a Refresh is waiting, and answers it', async () => {
    const requests = new KeyPackageRefreshRequests();
    expect(requests.claim().forced).toBe(false);
    const a = requests.request(1000);
    const b = requests.request(1000);
    const run = requests.claim();
    expect(run.forced).toBe(true);
    expect(requests.claim().forced).toBe(false); // taken by that run
    run.settle(true);
    await expect(Promise.all([a, b])).resolves.toEqual([true, true]);
  });

  test('success is never assumed: a failed run answers false, and the first answer wins', async () => {
    const requests = new KeyPackageRefreshRequests();
    const answer = requests.request(1000);
    const run = requests.claim();
    run.settle(false);
    run.settle(true);
    await expect(answer).resolves.toBe(false);
  });

  test('gives up after the time limit, without forcing a later run', async () => {
    jest.useFakeTimers();
    const requests = new KeyPackageRefreshRequests();
    const answer = requests.request(1000);
    jest.advanceTimersByTime(1000);
    await expect(answer).resolves.toBe(false);
    expect(requests.claim().forced).toBe(false);
  });
});
