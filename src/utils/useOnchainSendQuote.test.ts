import { act, renderHook } from '@testing-library/react-native';
import { useOnchainSendQuote } from './useOnchainSendQuote';
import { getReverseSwapFees, type SwapFees } from '../services/boltzService';
import { estimateSendFeeResult } from '../services/onchainService';
import { NoSwapServerError } from '../services/swapBackendService';

jest.mock('../services/boltzService', () => ({ getReverseSwapFees: jest.fn() }));
jest.mock('../services/onchainService', () => ({ estimateSendFeeResult: jest.fn() }));
const fees: SwapFees = { percentage: 0.5, minerFee: 304, minAmount: 1000, maxAmount: 1000000 };
const base = {
  visible: true,
  address: 'bc1-test',
  walletId: 'one',
  viaSwap: true,
  amountSats: 20000,
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
beforeEach(() => {
  jest.clearAllMocks();
});

it('distinguishes an unset server from an unreachable configured server', async () => {
  jest.mocked(getReverseSwapFees).mockRejectedValueOnce(new NoSwapServerError());
  const { result, rerender } = renderHook((props: typeof base) => useOnchainSendQuote(props), {
    initialProps: base,
  });
  await act(async () => {});
  expect(result.current).toMatchObject({
    fees: null,
    loading: false,
    errorKey: 'swapBackend.notConfigured',
  });
  jest.mocked(getReverseSwapFees).mockRejectedValueOnce(new Error('offline'));
  rerender({ ...base, address: 'another' });
  await act(async () => {});
  expect(result.current.errorKey).toBe('swapBackend.quoteFailed');
});
it('invalidates quotes immediately on wallet changes and ignores late results', async () => {
  const first = deferred<SwapFees>();
  const second = deferred<SwapFees>();
  jest
    .mocked(getReverseSwapFees)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const { result, rerender } = renderHook((props: typeof base) => useOnchainSendQuote(props), {
    initialProps: base,
  });
  const oldAdopt = result.current.adopt;
  rerender({ ...base, walletId: 'two' });
  await act(async () => {
    first.resolve(fees);
    oldAdopt(fees);
  });
  expect(result.current).toMatchObject({ loading: true, fees: null });
  await act(async () => second.resolve({ ...fees, percentage: 2 }));
  expect(result.current.fees?.percentage).toBe(2);
});
it('discards a resolved quote when the amount changes or the sheet closes', async () => {
  jest.mocked(getReverseSwapFees).mockResolvedValue(fees);
  const { result, rerender } = renderHook((props: typeof base) => useOnchainSendQuote(props), {
    initialProps: base,
  });
  await act(async () => {});
  rerender({ ...base, amountSats: 30000 });
  expect(result.current).toMatchObject({ loading: true, fees: null });
  await act(async () => {});
  rerender({ ...base, visible: false });
  expect(result.current).toMatchObject({ loading: false, fees: null });
});
it('prices direct sends with the selected wallet without consulting a swap server', async () => {
  jest.mocked(estimateSendFeeResult).mockResolvedValueOnce({ kind: 'fee', feeSats: 321 });
  const { result } = renderHook(() => useOnchainSendQuote({ ...base, viaSwap: false }));
  await act(async () => {});
  // Priced against the real recipient script, not a placeholder.
  expect(estimateSendFeeResult).toHaveBeenCalledWith('one', 20000, { toAddress: 'bc1-test' });
  expect(getReverseSwapFees).not.toHaveBeenCalled();
  expect(result.current).toMatchObject({ directFeeSats: 321, fees: null, loading: false });
});
it('withholds a direct quote when its transaction cannot be built', async () => {
  jest.mocked(estimateSendFeeResult).mockResolvedValueOnce({ kind: 'error' });
  const { result } = renderHook(() => useOnchainSendQuote({ ...base, viaSwap: false }));
  await act(async () => {});
  expect(result.current).toMatchObject({
    directFeeSats: null,
    directShortfall: null,
    errorKey: 'sendSheet.feeUnavailable',
    loading: false,
  });
});
it('reports an unfundable direct send as a shortfall, not a fee error', async () => {
  jest
    .mocked(estimateSendFeeResult)
    .mockResolvedValueOnce({ kind: 'insufficient', neededSats: 20210, availableSats: 4851 });
  const { result } = renderHook(() => useOnchainSendQuote({ ...base, viaSwap: false }));
  await act(async () => {});
  expect(result.current).toMatchObject({
    directFeeSats: null,
    directShortfall: { neededSats: 20210, availableSats: 4851 },
    errorKey: null,
    loading: false,
  });
});
it('re-prices a direct send after a wallet sync without the target changing', async () => {
  jest
    .mocked(estimateSendFeeResult)
    .mockResolvedValueOnce({ kind: 'insufficient', neededSats: 20210, availableSats: 4851 })
    .mockResolvedValueOnce({ kind: 'fee', feeSats: 210 });
  const direct = { ...base, viaSwap: false, walletSyncKey: '4851:3' };
  const { result, rerender } = renderHook((props: typeof direct) => useOnchainSendQuote(props), {
    initialProps: direct,
  });
  await act(async () => {});
  expect(result.current.directShortfall).not.toBeNull();
  rerender({ ...direct, walletSyncKey: '54851:4' });
  expect(result.current.loading).toBe(true);
  await act(async () => {});
  expect(result.current).toMatchObject({ directFeeSats: 210, directShortfall: null });
});
it('does not refetch swap fees on our own wallet syncs', async () => {
  jest.mocked(getReverseSwapFees).mockResolvedValue(fees);
  const swap = { ...base, walletSyncKey: '1:1' };
  const { result, rerender } = renderHook((props: typeof swap) => useOnchainSendQuote(props), {
    initialProps: swap,
  });
  await act(async () => {});
  rerender({ ...swap, walletSyncKey: '2:2' });
  expect(result.current.loading).toBe(false);
  expect(getReverseSwapFees).toHaveBeenCalledTimes(1);
});
it('retries a failed swap quote on demand', async () => {
  jest
    .mocked(getReverseSwapFees)
    .mockRejectedValueOnce(new Error('Boltz API error: 503'))
    .mockResolvedValueOnce(fees);
  const { result } = renderHook(() => useOnchainSendQuote(base));
  await act(async () => {});
  expect(result.current.errorKey).toBe('swapBackend.quoteFailed');
  act(() => result.current.retry());
  expect(result.current).toMatchObject({ loading: true, errorKey: null });
  await act(async () => {});
  expect(result.current).toMatchObject({ fees, errorKey: null, loading: false });
});
it('adopts a server-refreshed quote for the same send after preflight rejects stale fees', async () => {
  jest.mocked(getReverseSwapFees).mockResolvedValue(fees);
  const { result } = renderHook(() => useOnchainSendQuote(base));
  await act(async () => {});
  act(() => result.current.adopt({ ...fees, percentage: 3 }));
  expect(result.current.fees?.percentage).toBe(3);
});

it('rejects an old send callback after reopening the identical target', async () => {
  const replacement = deferred<SwapFees>();
  jest
    .mocked(getReverseSwapFees)
    .mockResolvedValueOnce(fees)
    .mockReturnValueOnce(replacement.promise);
  const { result, rerender } = renderHook((props: typeof base) => useOnchainSendQuote(props), {
    initialProps: base,
  });
  await act(async () => {});
  const oldAdopt = result.current.adopt;
  rerender({ ...base, visible: false });
  rerender(base);
  act(() => oldAdopt(fees));
  expect(result.current).toMatchObject({ fees: null, loading: true });
  await act(async () => replacement.resolve({ ...fees, percentage: 4 }));
  expect(result.current.fees?.percentage).toBe(4);
});
