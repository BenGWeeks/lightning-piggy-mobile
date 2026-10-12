import { act, renderHook } from '@testing-library/react-native';
import { InteractionManager } from 'react-native';
import { usePrefetchAddWalletWizard } from '../components/LazyAddWalletWizard';

const mockCancel = jest.fn();
let schedule: jest.SpyInstance;
beforeEach(() => {
  jest.useFakeTimers();
  mockCancel.mockClear();
  schedule = jest.spyOn(InteractionManager, 'runAfterInteractions').mockReturnValue({
    cancel: mockCancel,
    then: jest.fn(),
    done: jest.fn(),
  });
});
afterEach(() => {
  schedule.mockRestore();
  jest.useRealTimers();
});

it('waits for startup to settle before scheduling the wizard import after interactions', () => {
  const { unmount } = renderHook(() => usePrefetchAddWalletWizard());
  expect(schedule).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(2999));
  expect(schedule).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(1));
  expect(schedule).toHaveBeenCalledTimes(1);
  expect(schedule).toHaveBeenCalledWith(expect.any(Function));
  unmount();
  expect(mockCancel).toHaveBeenCalledTimes(1);
});

it('cancels warm-up when the host unmounts before the startup delay', () => {
  const { unmount } = renderHook(() => usePrefetchAddWalletWizard());
  unmount();
  act(() => jest.advanceTimersByTime(3000));
  expect(schedule).not.toHaveBeenCalled();
});
