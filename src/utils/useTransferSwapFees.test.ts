import { act, renderHook } from '@testing-library/react-native';
import { getReverseSwapFees, getSubmarineSwapFees, type SwapFees } from '../services/boltzService';
import { useTransferSwapFees } from './useTransferSwapFees';
jest.mock('../services/boltzService', () => ({
  getReverseSwapFees: jest.fn(),
  getSubmarineSwapFees: jest.fn(),
}));
const reverse: SwapFees = { percentage: 1, minerFee: 100, minAmount: 25000, maxAmount: 500000 };
const submarine: SwapFees = { ...reverse, minAmount: 10000 };
it('withholds old limits while the opposite direction loads and ignores superseded results', async () => {
  let resolveReverse!: (fees: SwapFees) => void;
  let resolveSubmarine!: (fees: SwapFees) => void;
  jest.mocked(getReverseSwapFees).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveReverse = resolve;
      }),
  );
  jest.mocked(getSubmarineSwapFees).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveSubmarine = resolve;
      }),
  );
  const { result, rerender } = renderHook<
    ReturnType<typeof useTransferSwapFees>,
    { direction: string }
  >(({ direction }) => useTransferSwapFees(direction, true), {
    initialProps: { direction: 'ln-to-onchain' },
  });
  await act(async () => resolveReverse(reverse));
  expect(result.current.fees?.minAmount).toBe(25000);
  rerender({ direction: 'onchain-to-ln' });
  expect(result.current.fees).toBeNull();
  rerender({ direction: 'ln-to-onchain' });
  await act(async () => resolveSubmarine(submarine));
  expect(result.current.fees).toBeNull();
  await act(async () => resolveReverse(reverse));
  expect(result.current.fees).toEqual(reverse);
});
it('leaves fees unavailable when the backend fails', async () => {
  jest.mocked(getReverseSwapFees).mockRejectedValueOnce(new Error('offline'));
  const { result } = renderHook(() => useTransferSwapFees('ln-to-onchain', true));
  await act(async () => {});
  expect(result.current.fees).toBeNull();
  expect(result.current.failed).toBe(true);
  jest.mocked(getReverseSwapFees).mockResolvedValueOnce(reverse);
  await act(async () => result.current.retry());
  expect(result.current.fees).toEqual(reverse);
  expect(result.current.failed).toBe(false);
});
