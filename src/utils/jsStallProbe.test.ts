import { startJsStallProbe } from './jsStallProbe';

describe('startJsStallProbe', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('reports a late timer as a stall and clears its interval on stop', () => {
    const probe = startJsStallProbe(50);
    jest.advanceTimersByTime(50);
    // Simulate the thread being busy for 300 ms before the next tick.
    jest.setSystemTime(Date.now() + 300);
    jest.advanceTimersByTime(50);
    const report = probe.stop();
    expect(report.maxMs).toBeGreaterThanOrEqual(250);
    expect(report.blockedMs).toBeGreaterThanOrEqual(250);
    expect(jest.getTimerCount()).toBe(0);
    expect(probe.stop()).toBe(report);
  });
});
