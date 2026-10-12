import {
  completeReverseSwap,
  deferSwapRefresh,
  SWAP_REFRESH_DELAY_MS,
  SWAP_COMPLETE_TOAST_MS,
} from './swapCompletion';
import { markSwapPlaceholdersResolved } from './swapPendingMerge';
import { createI18nInstance } from '../i18n';
const mockShow = jest.fn();
jest.mock('../components/BrandedToast', () => ({
  __esModule: true,
  default: { show: (...args: unknown[]) => mockShow(...args) },
}));
jest.mock('./swapPendingMerge', () => ({ markSwapPlaceholdersResolved: jest.fn() }));

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => jest.useRealTimers());

it('completes the claim and follows settlement without awaiting or starting a blocking refresh', async () => {
  const i18n = createI18nInstance('es');
  const refresh = jest.fn(() => new Promise<void>(() => {}));
  const followSettle = jest.fn();
  expect(
    completeReverseSwap({
      swapId: 'swap',
      amount: '31.732',
      txId: '0123456789abcdef',
      t: (key, options) => i18n.t(key, options),
      refresh,
      followSettle,
      deferRefresh: deferSwapRefresh,
    }),
  ).toBeUndefined();
  expect(markSwapPlaceholdersResolved).toHaveBeenCalledWith('swap');
  expect(followSettle).toHaveBeenCalledTimes(1);
  expect(mockShow).toHaveBeenCalledWith(
    expect.objectContaining({
      text1: 'Intercambio completado',
      text2: expect.stringContaining('31.732 sats'),
      visibilityTime: SWAP_COMPLETE_TOAST_MS,
    }),
  );
  await jest.advanceTimersByTimeAsync(SWAP_COMPLETE_TOAST_MS);
  expect(refresh).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(SWAP_REFRESH_DELAY_MS - SWAP_COMPLETE_TOAST_MS);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it.each(['throw', 'reject'])('contains a deferred refresh failure (%s)', async (mode) => {
  const refresh = jest.fn(() => {
    if (mode === 'throw') throw new Error('offline');
    return Promise.reject(new Error('offline'));
  });
  completeReverseSwap({
    swapId: 's',
    amount: '1',
    txId: 'tx',
    t: String,
    refresh,
    followSettle: jest.fn(),
    deferRefresh: deferSwapRefresh,
  });
  await jest.advanceTimersByTimeAsync(SWAP_REFRESH_DELAY_MS);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('cancels even after the timer fires but before the refresh microtask starts', async () => {
  const refresh = jest.fn(async () => {});
  const cancel = deferSwapRefresh(refresh);
  jest.advanceTimersByTime(SWAP_REFRESH_DELAY_MS);
  cancel();
  await Promise.resolve();
  expect(refresh).not.toHaveBeenCalled();
});

it('checks identity when the deferred refresh actually starts', async () => {
  const refresh = jest.fn(async () => {});
  let current = true;
  deferSwapRefresh(refresh, () => current);
  jest.advanceTimersByTime(SWAP_REFRESH_DELAY_MS);
  current = false;
  await Promise.resolve();
  expect(refresh).not.toHaveBeenCalled();
});
