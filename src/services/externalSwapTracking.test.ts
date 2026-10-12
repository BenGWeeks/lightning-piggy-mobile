import { trackExternalSwap } from './externalSwapTracking';
import { watchSubmarineSwapStatus } from './boltzSwapStatus';
import { saveExternalSwap, type ExternalSwapState } from './externalSwapState';
jest.mock('./boltzSwapStatus', () => ({
  watchSubmarineSwapStatus: jest.fn(),
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
beforeEach(() => jest.clearAllMocks());
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
