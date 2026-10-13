import { trackExternalSwap, subscribeExternalSwap } from './externalSwapTracking';
import { watchSubmarineSwapStatus, fetchSwapStatus } from './boltzSwapStatus';
import { saveExternalSwap, type ExternalSwapState } from './externalSwapState';
jest.mock('./boltzSwapStatus', () => ({
  watchSubmarineSwapStatus: jest.fn(),
  fetchSwapStatus: jest.fn(),
  classifySubmarineSwapStatus: (status: string) =>
    status === 'transaction.claimed'
      ? 'complete'
      : status === 'swap.expired'
        ? 'failed'
        : 'awaiting-payment',
}));
jest.mock('./externalSwapState', () => ({ saveExternalSwap: jest.fn(async () => {}) }));
const state = { id: 'background', status: 'swap.created' } as ExternalSwapState;
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchSwapStatus).mockResolvedValue('swap.created');
});
test('one app-level watcher persists settlement and runs recovery after the sheet closes', async () => {
  let finish!: (value: Awaited<ReturnType<typeof watchSubmarineSwapStatus>>) => void;
  jest.mocked(watchSubmarineSwapStatus).mockImplementationOnce(async (_id, onPhase) => {
    onPhase('complete', 'transaction.claimed', {});
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const recover = jest.fn(async () => {});
  trackExternalSwap(state, recover);
  trackExternalSwap(state, recover);
  expect(watchSubmarineSwapStatus).toHaveBeenCalledTimes(1);
  finish({ phase: 'complete', rawStatus: 'transaction.claimed', raw: {} });
  await flush();
  expect(saveExternalSwap).toHaveBeenCalledWith({ ...state, status: 'transaction.claimed' });
  expect(recover).toHaveBeenCalledTimes(1);
});
test('network failure keeps pending instructions and allows a later recovery retry', async () => {
  jest.mocked(watchSubmarineSwapStatus).mockRejectedValue(new Error('Offline'));
  const recover = jest.fn(async () => {});
  trackExternalSwap({ ...state, id: 'offline' }, recover);
  await flush();
  expect(saveExternalSwap).not.toHaveBeenCalled();
  expect(recover).not.toHaveBeenCalled();
  trackExternalSwap({ ...state, id: 'offline' }, recover);
  await flush();
  expect(watchSubmarineSwapStatus).toHaveBeenCalledTimes(2);
});
test('does not arm another watcher for a completed swap', () => {
  trackExternalSwap({ ...state, status: 'transaction.claimed' }, jest.fn());
  expect(watchSubmarineSwapStatus).not.toHaveBeenCalled();
});

test.each(['transaction.claimed', 'invoice.failedToPay'])(
  'storage failure does not suppress recovery for %s',
  async (status) => {
    jest.mocked(saveExternalSwap).mockRejectedValueOnce(new Error('Disk full'));
    jest.mocked(watchSubmarineSwapStatus).mockImplementationOnce(async (_id, onPhase) => {
      onPhase('detected', 'transaction.mempool', {});
      onPhase(status === 'transaction.claimed' ? 'complete' : 'failed', status, {});
      return {
        phase: status === 'transaction.claimed' ? 'complete' : 'failed',
        rawStatus: status,
        raw: {},
      };
    });
    const recover = jest.fn(async () => {});
    trackExternalSwap({ ...state, id: status }, recover);
    await flush();
    expect(saveExternalSwap).toHaveBeenLastCalledWith({ ...state, id: status, status });
    expect(recover).toHaveBeenCalledTimes(1);
  },
);

test('recovery runs even when the final public-state write rejects', async () => {
  jest.mocked(saveExternalSwap).mockRejectedValueOnce(new Error('Disk full'));
  jest.mocked(watchSubmarineSwapStatus).mockImplementationOnce(async (_id, onPhase) => {
    onPhase('failed', 'invoice.failedToPay', {});
    return { phase: 'failed', rawStatus: 'invoice.failedToPay', raw: {} };
  });
  const recover = jest.fn(async () => {});
  trackExternalSwap({ ...state, id: 'failed-final-write' }, recover);
  await flush();
  expect(saveExternalSwap).toHaveBeenCalledTimes(1);
  expect(recover).toHaveBeenCalledTimes(1);
});

test('Move subscribers share the app watcher and detach without stopping settlement', async () => {
  let update!: Parameters<typeof watchSubmarineSwapStatus>[1];
  let finish!: (value: Awaited<ReturnType<typeof watchSubmarineSwapStatus>>) => void;
  jest.mocked(watchSubmarineSwapStatus).mockImplementationOnce(async (_id, onPhase) => {
    update = onPhase;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const recover = jest.fn(async () => {});
  trackExternalSwap({ ...state, id: 'shared' }, recover);
  const first = jest.fn();
  const second = jest.fn();
  const closeFirst = subscribeExternalSwap('shared', first);
  const closeSecond = subscribeExternalSwap('shared', second);
  await flush();
  expect(watchSubmarineSwapStatus).toHaveBeenCalledTimes(1);
  expect(fetchSwapStatus).toHaveBeenCalledTimes(1);
  update('detected', 'transaction.mempool', {});
  expect(first).toHaveBeenLastCalledWith(
    expect.objectContaining({ status: 'transaction.mempool' }),
  );
  expect(second).toHaveBeenLastCalledWith(
    expect.objectContaining({ status: 'transaction.mempool' }),
  );
  closeFirst();
  closeSecond();
  update('complete', 'transaction.claimed', {});
  finish({ phase: 'complete', rawStatus: 'transaction.claimed', raw: {} });
  await flush();
  expect(recover).toHaveBeenCalledTimes(1);
  expect(first).toHaveBeenCalledTimes(3);
});

test.each(['transaction.mempool', 'invoice.failedToPay'])(
  'reopening saved instructions checks the live %s status before allowing payment',
  async (status) => {
    jest.mocked(fetchSwapStatus).mockResolvedValueOnce(status);
    const listener = jest.fn();
    const close = subscribeExternalSwap('reopen', listener);
    expect(listener).toHaveBeenLastCalledWith({
      id: 'reopen',
      status: null,
      trackingFailed: false,
    });
    await flush();
    expect(listener).toHaveBeenLastCalledWith({ id: 'reopen', status, trackingFailed: false });
    close();
  },
);

test('tracking failure revokes previously live pending instructions', async () => {
  let reject!: (error: Error) => void;
  jest.mocked(watchSubmarineSwapStatus).mockImplementationOnce(
    async () =>
      new Promise((_resolve, rejectWatch) => {
        reject = rejectWatch;
      }),
  );
  trackExternalSwap({ ...state, id: 'disconnect' }, jest.fn());
  const listener = jest.fn();
  const close = subscribeExternalSwap('disconnect', listener);
  await flush();
  expect(listener).toHaveBeenLastCalledWith({
    id: 'disconnect',
    status: 'swap.created',
    trackingFailed: false,
  });
  reject(new Error('Offline'));
  await flush();
  expect(listener).toHaveBeenLastCalledWith({
    id: 'disconnect',
    status: null,
    trackingFailed: true,
  });
  close();
});

test('failed live validation hides instructions', async () => {
  jest.mocked(fetchSwapStatus).mockRejectedValueOnce(new Error('Offline'));
  const listener = jest.fn();
  const close = subscribeExternalSwap('unreachable', listener);
  await flush();
  expect(listener).toHaveBeenLastCalledWith({
    id: 'unreachable',
    status: null,
    trackingFailed: true,
  });
  close();
});

test('an older pending read cannot overwrite a newer funded watcher update', async () => {
  let resolve!: (status: string) => void;
  let update!: Parameters<typeof watchSubmarineSwapStatus>[1];
  let finish!: (value: Awaited<ReturnType<typeof watchSubmarineSwapStatus>>) => void;
  jest.mocked(fetchSwapStatus).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  jest.mocked(watchSubmarineSwapStatus).mockImplementationOnce(async (_id, onPhase) => {
    update = onPhase;
    return new Promise((done) => {
      finish = done;
    });
  });
  trackExternalSwap(
    { ...state, id: 'race' },
    jest.fn(async () => {}),
  );
  const listener = jest.fn();
  const close = subscribeExternalSwap('race', listener);
  update('detected', 'transaction.mempool', {});
  resolve('swap.created');
  await flush();
  expect(listener).toHaveBeenLastCalledWith(
    expect.objectContaining({ status: 'transaction.mempool' }),
  );
  finish({ phase: 'complete', rawStatus: 'transaction.claimed', raw: {} });
  await flush();
  close();
});
