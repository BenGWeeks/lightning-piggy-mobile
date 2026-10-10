import {
  CLAIM_MISSING_INPUTS_WINDOW_MS,
  broadcastWithRetry,
  classifyBroadcastError,
  waitForTxVisible,
} from './swapBroadcast';

// A virtual clock: `sleep` advances `now` instantly, so the bounded windows
// are exercised exactly without real waiting.
function virtualClock() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
  };
}

const MISSING = new Error(
  'sendrawtransaction RPC error: {"code":-25,"message":"bad-txns-inputs-missingorspent"}',
);

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('classifyBroadcastError', () => {
  it.each([
    'bad-txns-inputs-missingorspent',
    'Missing inputs',
    'missing-inputs',
    'Transaction not found',
    '',
  ])('treats %p as a not-yet-visible input', (message) => {
    expect(classifyBroadcastError(new Error(message))).toBe('missingInputs');
  });

  it.each([
    'txn-already-in-mempool',
    'txn-already-known',
    'Transaction already in block chain',
    'Transaction outputs already in utxo set',
  ])('treats %p as already broadcast', (message) => {
    expect(classifyBroadcastError(new Error(message))).toBe('alreadyKnown');
  });

  it.each(['min relay fee not met', 'txn-mempool-conflict', 'socket closed'])(
    'treats %p as some other failure',
    (message) => {
      expect(classifyBroadcastError(new Error(message))).toBe('other');
    },
  );
});

describe('waitForTxVisible', () => {
  it('polls until the backend sees the lockup', async () => {
    const clock = virtualClock();
    const probe = jest
      .fn<Promise<boolean | null>, []>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    await expect(waitForTxVisible(probe, 30_000, clock)).resolves.toBe(true);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(clock.sleeps).toEqual([1000, 2000]);
  });

  it('stops waiting at once when the probe cannot tell', async () => {
    const clock = virtualClock();
    const probe = jest.fn<Promise<boolean | null>, []>().mockResolvedValue(null);
    await expect(waitForTxVisible(probe, 30_000, clock)).resolves.toBe(false);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(clock.sleeps).toEqual([]);
  });

  it('treats a throwing probe as "cannot tell" and never throws', async () => {
    const probe = jest.fn<Promise<boolean | null>, []>().mockRejectedValue(new Error('offline'));
    await expect(waitForTxVisible(probe, 30_000, virtualClock())).resolves.toBe(false);
  });

  it('gives up after the bounded window', async () => {
    const clock = virtualClock();
    const probe = jest.fn<Promise<boolean | null>, []>().mockResolvedValue(false);
    await expect(waitForTxVisible(probe, 30_000, clock)).resolves.toBe(false);
    expect(clock.now()).toBe(30_000);
    expect(Math.max(...clock.sleeps)).toBeLessThanOrEqual(5000);
  });
});

describe('broadcastWithRetry', () => {
  it('retries missing-inputs rejections, then succeeds (the #1174 race)', async () => {
    const clock = virtualClock();
    const fn = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(MISSING)
      .mockRejectedValueOnce(MISSING)
      .mockResolvedValueOnce(undefined);
    await broadcastWithRetry(fn, 'claim', 'tx', {
      missingInputsWindowMs: CLAIM_MISSING_INPUTS_WINDOW_MS,
      ...clock,
    });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(clock.sleeps).toEqual([2000, 4000]);
  });

  it('keeps retrying missing inputs well past the old 4-attempt limit', async () => {
    const clock = virtualClock();
    const fn = jest.fn<Promise<void>, []>();
    for (let i = 0; i < 7; i++) fn.mockRejectedValueOnce(MISSING);
    fn.mockResolvedValueOnce(undefined);
    await broadcastWithRetry(fn, 'claim', 'tx', {
      missingInputsWindowMs: CLAIM_MISSING_INPUTS_WINDOW_MS,
      ...clock,
    });
    expect(fn).toHaveBeenCalledTimes(8);
  });

  it('gives up only once the bounded missing-inputs window has passed', async () => {
    const clock = virtualClock();
    const fn = jest.fn<Promise<void>, []>().mockRejectedValue(MISSING);
    await expect(
      broadcastWithRetry(fn, 'claim', 'tx', {
        missingInputsWindowMs: CLAIM_MISSING_INPUTS_WINDOW_MS,
        ...clock,
      }),
    ).rejects.toThrow(/claim broadcast failed after \d+ s \(.*missingorspent/);
    // Waited as long as the window allows, never longer, backoff capped at 15 s.
    expect(clock.now()).toBeLessThanOrEqual(CLAIM_MISSING_INPUTS_WINDOW_MS);
    expect(clock.now()).toBeGreaterThan(CLAIM_MISSING_INPUTS_WINDOW_MS - 15_000);
    expect(Math.max(...clock.sleeps)).toBe(15_000);
  });

  it('treats "already in mempool" as success without further attempts', async () => {
    const fn = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(MISSING)
      .mockRejectedValueOnce(new Error('txn-already-in-mempool'));
    await broadcastWithRetry(fn, 'claim', 'tx', {
      missingInputsWindowMs: CLAIM_MISSING_INPUTS_WINDOW_MS,
      ...virtualClock(),
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives other errors the original 4 attempts', async () => {
    const clock = virtualClock();
    const fn = jest.fn<Promise<void>, []>().mockRejectedValue(new Error('min relay fee not met'));
    await expect(
      broadcastWithRetry(fn, 'claim', 'tx', {
        missingInputsWindowMs: CLAIM_MISSING_INPUTS_WINDOW_MS,
        ...clock,
      }),
    ).rejects.toThrow(/min relay fee not met/);
    expect(fn).toHaveBeenCalledTimes(4);
    expect(clock.sleeps).toEqual([2000, 4000, 8000]);
  });

  it('without a window (refunds), missing inputs also get 4 attempts', async () => {
    const fn = jest.fn<Promise<void>, []>().mockRejectedValue(MISSING);
    await expect(broadcastWithRetry(fn, 'refund', 'tx', virtualClock())).rejects.toThrow(
      /refund broadcast failed/,
    );
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('keeps a readable message when BDK gives none', async () => {
    const fn = jest.fn<Promise<void>, []>().mockRejectedValue(new Error(''));
    await expect(broadcastWithRetry(fn, 'refund', 'tx', virtualClock())).rejects.toThrow(
      /Electrum propagation gap/,
    );
  });
});
