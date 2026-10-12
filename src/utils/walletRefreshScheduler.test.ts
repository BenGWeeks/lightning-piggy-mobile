import {
  createWalletRefreshScheduler,
  isWalletFresh,
  WALLET_FRESH_MS,
  WALLET_SWIPE_SETTLE_MS,
} from './walletRefreshScheduler';

// Resolve pending promise callbacks (the fetch result handling) between timers.
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('isWalletFresh', () => {
  it('is stale when the wallet never loaded', () => {
    expect(isWalletFresh(undefined, 1_000)).toBe(false);
  });

  it('is fresh within the window and stale at its edge', () => {
    expect(isWalletFresh(1_000, 1_000 + WALLET_FRESH_MS - 1)).toBe(true);
    expect(isWalletFresh(1_000, 1_000 + WALLET_FRESH_MS)).toBe(false);
  });
});

describe('createWalletRefreshScheduler', () => {
  let clock: number;
  let fetch: jest.Mock<Promise<boolean>, [string, { force: boolean }]>;
  let onChange: jest.Mock;

  const make = () => createWalletRefreshScheduler({ fetch, onChange, now: () => clock });

  beforeEach(() => {
    jest.useFakeTimers();
    clock = 1_000_000;
    fetch = jest.fn().mockResolvedValue(true);
    onChange = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('loads a card that became active once it settles, not before', async () => {
    const s = make();
    s.activate('a');
    expect(s.isLoading('a')).toBe(true); // due: indicator shows during the settle wait
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS - 1);
    expect(fetch).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(fetch).toHaveBeenCalledWith('a', { force: false });
    expect(s.isLoading('a')).toBe(true); // in flight
    await flush();
    expect(s.isLoading('a')).toBe(false);
  });

  it('debounces a fast flick so only the card it lands on fetches', () => {
    const s = make();
    s.activate('a');
    jest.advanceTimersByTime(100);
    s.activate('b');
    jest.advanceTimersByTime(100);
    s.activate('c');
    expect(s.isLoading('a')).toBe(false);
    expect(s.isLoading('b')).toBe(false);
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('c', { force: false });
  });

  it('skips a wallet that loaded within the last 30 s', async () => {
    const s = make();
    s.activate('a');
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    await flush();
    s.activate('b');
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    await flush();
    fetch.mockClear();

    clock += WALLET_FRESH_MS - 1;
    s.activate('a'); // swipe back inside the window
    expect(s.isLoading('a')).toBe(false); // no indicator for a skipped refresh
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    expect(fetch).not.toHaveBeenCalled();

    clock += 1; // window lapsed
    s.activate('a');
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    expect(fetch).toHaveBeenCalledWith('a', { force: false });
  });

  it('retries a failed fetch on the next activation instead of treating it as loaded', async () => {
    fetch.mockResolvedValueOnce(false);
    const s = make();
    s.activate('a');
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    await flush();
    expect(s.isLoading('a')).toBe(false);

    // e.g. the NWC wallet reconnects (availability flip) or the user swipes back
    s.activate('a');
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('treats a rejected fetch as a failure', async () => {
    fetch.mockRejectedValueOnce(new Error('relay down'));
    const s = make();
    s.activate('a');
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    await flush();
    expect(s.isLoading('a')).toBe(false);
    s.activate('a');
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not start a second fetch for a wallet already in flight', () => {
    fetch.mockReturnValue(new Promise(() => {})); // never settles
    const s = make();
    s.activate('a');
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    s.activate('b');
    s.activate('a');
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(s.isLoading('a')).toBe(true);
  });

  it('pull-to-refresh forces a fetch now, even when fresh, and cancels the pending one', async () => {
    const s = make();
    s.activate('a');
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    await flush();
    fetch.mockClear();

    await expect(s.refreshNow('a')).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith('a', { force: true });

    clock += WALLET_FRESH_MS; // stale again, so activation schedules a fetch…
    s.activate('a');
    const forced = s.refreshNow('a'); // …which pull-to-refresh supersedes
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    await forced;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith('a', { force: true });
  });

  it('a pull-to-refresh failure leaves the wallet due for the next activation', async () => {
    fetch.mockResolvedValueOnce(false);
    const s = make();
    await expect(s.refreshNow('a')).resolves.toBe(false);
    s.activate('a');
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('activating no wallet (the add card) cancels the pending fetch', () => {
    const s = make();
    s.activate('a');
    s.activate(null);
    expect(s.isLoading('a')).toBe(false);
    expect(s.isLoading(null)).toBe(false);
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('notifies only when a loading state flips', async () => {
    const s = make();
    s.activate('a'); // scheduled
    expect(onChange).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS); // started
    expect(onChange).toHaveBeenCalledTimes(2);
    await flush(); // settled
    expect(onChange).toHaveBeenCalledTimes(3);
    s.activate('a'); // fresh: nothing scheduled, nothing to notify
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('keeps freshness per wallet', async () => {
    const s = make();
    s.activate('a');
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    await flush();
    s.activate('b');
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    expect(fetch).toHaveBeenLastCalledWith('b', { force: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries once when re-activated mid-fetch and that fetch fails (e.g. a reconnect)', async () => {
    let fail!: (ok: boolean) => void;
    fetch.mockImplementationOnce(() => new Promise<boolean>((r) => (fail = r)));
    const s = make();
    s.activate('a');
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    s.activate('a'); // availability flipped while the first fetch runs
    fail(false);
    await flush();
    expect(s.isLoading('a')).toBe(true); // retry is due
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    expect(fetch).toHaveBeenCalledTimes(2);
    await flush();
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS * 10);
    expect(fetch).toHaveBeenCalledTimes(2); // once only, no loop
  });

  it('does not retry a mid-fetch re-activation once the user swiped elsewhere', async () => {
    let fail!: (ok: boolean) => void;
    fetch.mockImplementationOnce(() => new Promise<boolean>((r) => (fail = r)));
    const s = make();
    s.activate('a');
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    s.activate('a');
    s.activate(null); // now on the add card
    fail(false);
    await flush();
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a failed refresh clears an earlier success, so swiping back retries', async () => {
    const s = make();
    s.activate('a');
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    await flush(); // loaded OK
    fetch.mockResolvedValueOnce(false);
    await s.refreshNow('a'); // pull-to-refresh fails
    s.activate('b');
    s.activate('a'); // within the original 30 s window
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenLastCalledWith('a', { force: false });
  });

  it('queues pull-to-refresh behind a running fetch so the newest result commits last', async () => {
    const order: string[] = [];
    let finishBackground!: (ok: boolean) => void;
    fetch
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((r) => {
            finishBackground = (ok) => {
              order.push('background');
              r(ok);
            };
          }),
      )
      .mockImplementationOnce(async () => {
        order.push('forced');
        return true;
      });
    const s = make();
    s.activate('a');
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    const forced = s.refreshNow('a');
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1); // forced waits its turn
    expect(s.isLoading('a')).toBe(true);
    finishBackground(true);
    await expect(forced).resolves.toBe(true);
    expect(order).toEqual(['background', 'forced']);
    expect(fetch).toHaveBeenLastCalledWith('a', { force: true });
    await flush();
    expect(s.isLoading('a')).toBe(false);
  });

  describe('neighbour prefetch', () => {
    const neighbours: Record<string, string[]> = { b: ['c', 'a'], c: ['b'], a: ['b'] };
    const makeWithNeighbours = () =>
      createWalletRefreshScheduler({
        fetch,
        onChange,
        now: () => clock,
        getNeighbours: (id) => neighbours[id] ?? [],
      });

    it('warms neighbours one at a time after the active card loads', async () => {
      const resolvers: ((ok: boolean) => void)[] = [];
      fetch.mockImplementation(() => new Promise<boolean>((r) => resolvers.push(r)));
      const s = makeWithNeighbours();
      s.activate('b');
      jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
      expect(fetch.mock.calls.map((c) => c[0])).toEqual(['b']);
      resolvers[0](true);
      await flush();
      expect(fetch.mock.calls.map((c) => c[0])).toEqual(['b', 'c']); // one at a time
      expect(s.isLoading('b')).toBe(false); // neighbour work never shows on the active card
      resolvers[1](true);
      await flush();
      expect(fetch.mock.calls.map((c) => c[0])).toEqual(['b', 'c', 'a']);
      resolvers[2](true);
      await flush();
    });

    it('makes the next swipe instant: a prefetched neighbour is fresh', async () => {
      const s = makeWithNeighbours();
      s.activate('b');
      jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
      await flush();
      await flush();
      expect(fetch).toHaveBeenCalledTimes(3);
      s.activate('c');
      expect(s.isLoading('c')).toBe(false);
      jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
      await flush();
      expect(fetch).toHaveBeenCalledTimes(3); // c fresh; its neighbour b fresh too
    });

    it('warms neighbours of an already-fresh card after it settles', async () => {
      const s = makeWithNeighbours();
      await s.refreshNow('b');
      fetch.mockClear();
      s.activate('b');
      jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
      await flush();
      expect(fetch.mock.calls[0]).toEqual(['c', { force: false }]);
    });

    it('stops the queue when the user swipes on', async () => {
      const resolvers: ((ok: boolean) => void)[] = [];
      fetch.mockImplementation(() => new Promise<boolean>((r) => resolvers.push(r)));
      const s = makeWithNeighbours();
      s.activate('b');
      jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
      resolvers[0](true);
      await flush(); // c prefetch running
      s.activate(null); // swiped onto the add card
      resolvers[1](true);
      await flush();
      expect(fetch.mock.calls.map((c) => c[0])).toEqual(['b', 'c']); // a never starts
    });

    it('does not prefetch when the active card failed to load', async () => {
      fetch.mockResolvedValueOnce(false);
      const s = makeWithNeighbours();
      s.activate('b');
      jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
      await flush();
      await flush();
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('does not prefetch during a fast flick', () => {
      const s = makeWithNeighbours();
      s.activate('a');
      jest.advanceTimersByTime(100);
      s.activate('b');
      jest.advanceTimersByTime(100);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  it('honours a per-wallet freshness window', async () => {
    const s = createWalletRefreshScheduler({
      fetch,
      now: () => clock,
      freshMsFor: (id) => (id === 'chain' ? 5 * 60_000 : WALLET_FRESH_MS),
    });
    await s.refreshNow('chain');
    clock += WALLET_FRESH_MS * 2;
    s.activate('chain');
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports fetching separately from due', async () => {
    const s = make();
    s.activate('a');
    expect(s.isLoading('a')).toBe(true);
    expect(s.isFetching('a')).toBe(false); // only debouncing
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    expect(s.isFetching('a')).toBe(true);
    await flush();
    expect(s.isFetching('a')).toBe(false);
    expect(s.isFetching(null)).toBe(false);
  });
});
