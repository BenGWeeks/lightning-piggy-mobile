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
  const { result, rerender } = renderHook<SwapFees | null, { direction: string }>(
    ({ direction }) => useTransferSwapFees(direction, true),
    {
      initialProps: { direction: 'ln-to-onchain' },
    },
  );
  await act(async () => resolveReverse(reverse));
  expect(result.current?.minAmount).toBe(25000);
  rerender({ direction: 'onchain-to-ln' });
  expect(result.current).toBeNull();
  rerender({ direction: 'ln-to-onchain' });
  await act(async () => resolveSubmarine(submarine));
  expect(result.current).toBeNull();
  await act(async () => resolveReverse(reverse));
  expect(result.current).toEqual(reverse);
});
it('leaves fees unavailable when the backend fails', async () => {
  jest.mocked(getReverseSwapFees).mockRejectedValueOnce(new Error('offline'));
  const { result } = renderHook(() => useTransferSwapFees('ln-to-onchain', true));
  await act(async () => {});
  expect(result.current).toBeNull();
});
