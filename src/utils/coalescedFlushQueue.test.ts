import { createCoalescedFlushQueue } from './coalescedFlushQueue';

describe('createCoalescedFlushQueue', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(100_000);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const make = (onFlush: (batch: number[]) => void) =>
    createCoalescedFlushQueue<number>({ flushMs: 150, threshold: 25, onFlush });

  it('flushes the very first item immediately (leading edge, #934 item 3)', () => {
    const flushes: number[][] = [];
    const q = make((b) => flushes.push(b));
    q.push(1);
    expect(flushes).toEqual([[1]]);
  });

  it('flushes immediately again after a quiet window', () => {
    const flushes: number[][] = [];
    const q = make((b) => flushes.push(b));
    q.push(1); // leading edge
    jest.advanceTimersByTime(500); // quiet — well past the window
    q.push(2);
    expect(flushes).toEqual([[1], [2]]);
  });

  it('coalesces a burst into one trailing flush per window', () => {
    const flushes: number[][] = [];
    const q = make((b) => flushes.push(b));
    q.push(1); // t=0 leading edge
    jest.advanceTimersByTime(10);
    q.push(2); // mid-window → trailing timer
    jest.advanceTimersByTime(10);
    q.push(3); // timer already pending — no new timer
    expect(flushes).toEqual([[1]]);
    jest.advanceTimersByTime(150);
    expect(flushes).toEqual([[1], [2, 3]]);
  });

  it('bounds worst-case latency at flushMs from the previous flush, not from the push', () => {
    const flushes: number[][] = [];
    const q = make((b) => flushes.push(b));
    q.push(1); // t=0 flush
    jest.advanceTimersByTime(100);
    q.push(2); // t=100 → trailing timer should fire at t=150, i.e. in 50ms
    jest.advanceTimersByTime(49);
    expect(flushes).toEqual([[1]]);
    jest.advanceTimersByTime(1);
    expect(flushes).toEqual([[1], [2]]);
  });

  it('flushes synchronously at the threshold regardless of the window', () => {
    const flushes: number[][] = [];
    const q = make((b) => flushes.push(b));
    q.push(0); // t=0 leading edge
    jest.advanceTimersByTime(1);
    for (let i = 1; i <= 25; i++) q.push(i); // hits threshold mid-window
    expect(flushes).toHaveLength(2);
    expect(flushes[1]).toHaveLength(25);
    // The pending trailing timer was cleared by the threshold flush — nothing more fires.
    jest.advanceTimersByTime(1000);
    expect(flushes).toHaveLength(2);
  });

  it('manual flush() drains pending items and is a no-op when empty', () => {
    const flushes: number[][] = [];
    const q = make((b) => flushes.push(b));
    q.flush(); // empty — no-op
    expect(flushes).toEqual([]);
    q.push(1); // leading edge
    jest.advanceTimersByTime(10);
    q.push(2); // pending on trailing timer
    q.flush(); // teardown-style drain
    expect(flushes).toEqual([[1], [2]]);
    jest.advanceTimersByTime(1000); // cleared timer must not double-fire
    expect(flushes).toEqual([[1], [2]]);
  });
});
