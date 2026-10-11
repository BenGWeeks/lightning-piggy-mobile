import { act, renderHook } from '@testing-library/react-native';
import { useReceiveSwapFees } from './useReceiveSwapFees';
import { getSubmarineSwapFees, type SwapFees } from '../services/boltzService';
import { NoSwapServerError } from '../services/swapBackendService';

jest.mock('../services/boltzService', () => ({ getSubmarineSwapFees: jest.fn() }));
const fees: SwapFees = { percentage: 0.1, minerFee: 300, minAmount: 25000, maxAmount: 1000000 };

beforeEach(() => jest.clearAllMocks());

it('recovers from a failed first quote when the user confirms', async () => {
  jest
    .mocked(getSubmarineSwapFees)
    .mockRejectedValueOnce(new Error('Network request failed'))
    .mockResolvedValueOnce(fees);
  const { result } = renderHook(() => useReceiveSwapFees(true));
  await act(async () => {});
  expect(result.current).toMatchObject({ fees: null, errorKey: 'swapBackend.quoteFailed' });
  let quote;
  await act(async () => {
    quote = await result.current.ensureFees();
  });
  expect(quote).toEqual({ fees });
  expect(result.current).toMatchObject({ fees, errorKey: null });
  expect(getSubmarineSwapFees).toHaveBeenCalledTimes(2);
});
it('returns translated keys, never the raw server text', async () => {
  jest.mocked(getSubmarineSwapFees).mockRejectedValue(new NoSwapServerError());
  const { result } = renderHook(() => useReceiveSwapFees(true));
  await act(async () => {});
  let quote;
  await act(async () => {
    quote = await result.current.ensureFees();
  });
  expect(quote).toEqual({ errorKey: 'swapBackend.notConfigured' });
});
it('reuses a loaded schedule without refetching', async () => {
  jest.mocked(getSubmarineSwapFees).mockResolvedValue(fees);
  const { result } = renderHook(() => useReceiveSwapFees(true));
  await act(async () => {});
  await act(async () => {
    expect(await result.current.ensureFees()).toEqual({ fees });
  });
  expect(getSubmarineSwapFees).toHaveBeenCalledTimes(1);
});
it('drops a late result once the sheet has closed', async () => {
  let resolve!: (f: SwapFees) => void;
  jest.mocked(getSubmarineSwapFees).mockReturnValueOnce(new Promise((done) => (resolve = done)));
  const { result, rerender } = renderHook((visible: boolean) => useReceiveSwapFees(visible), {
    initialProps: true,
  });
  rerender(false);
  await act(async () => resolve(fees));
  expect(result.current.fees).toBeNull();
});
