import { act, renderHook } from '@testing-library/react-native';
import { useOnchainSendQuote } from './useOnchainSendQuote';
import { getReverseSwapFees, type SwapFees } from '../services/boltzService';
import { estimateSendFee } from '../services/onchainService';
import { NoSwapServerError } from '../services/swapBackendService';

jest.mock('../services/boltzService', () => ({ getReverseSwapFees: jest.fn() }));
jest.mock('../services/onchainService', () => ({ estimateSendFee: jest.fn() }));
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
  jest.mocked(estimateSendFee).mockResolvedValueOnce(321);
  const { result } = renderHook(() => useOnchainSendQuote({ ...base, viaSwap: false }));
  await act(async () => {});
  expect(estimateSendFee).toHaveBeenCalledWith('one', 20000);
  expect(getReverseSwapFees).not.toHaveBeenCalled();
  expect(result.current).toMatchObject({ directFeeSats: 321, fees: null, loading: false });
});
it('withholds a direct quote when its transaction cannot be built', async () => {
  jest.mocked(estimateSendFee).mockResolvedValueOnce(null);
  const { result } = renderHook(() => useOnchainSendQuote({ ...base, viaSwap: false }));
  await act(async () => {});
  expect(result.current).toMatchObject({ directFeeSats: null, loading: false });
});
it('adopts a server-refreshed quote for the same send after preflight rejects stale fees', async () => {
  jest.mocked(getReverseSwapFees).mockResolvedValue(fees);
  const { result } = renderHook(() => useOnchainSendQuote(base));
  await act(async () => {});
  act(() => result.current.adopt({ ...fees, percentage: 3 }));
  expect(result.current.fees?.percentage).toBe(3);
});
