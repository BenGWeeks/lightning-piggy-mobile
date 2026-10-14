import { act, renderHook } from '@testing-library/react-native';
import { useMarmotDmDeviceSync, DM_DEVICE_SYNC_OPEN_DELAY_MS } from './useMarmotDmDeviceSync';
import { getMarmotSession } from '../services/marmotSession';

let mockFocus: () => (() => void) | void;
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (fn: typeof mockFocus) => {
    mockFocus = fn;
  },
}));
jest.mock('../services/marmotSession', () => ({ getMarmotSession: jest.fn() }));

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => jest.useRealTimers());

it('checks once after focus, never periodically, and cancels the check on blur', () => {
  const syncDmDevices = jest.fn().mockResolvedValue(undefined);
  jest.mocked(getMarmotSession).mockReturnValue({
    pubkey: 'owner',
    findDm: () => ({ id: 'dm' }),
    syncDmDevices,
  } as unknown as NonNullable<ReturnType<typeof getMarmotSession>>);
  renderHook(() => useMarmotDmDeviceSync('peer', 'owner'));
  let blur: (() => void) | void;
  act(() => {
    blur = mockFocus();
    jest.advanceTimersByTime(DM_DEVICE_SYNC_OPEN_DELAY_MS - 1);
  });
  expect(syncDmDevices).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(1));
  expect(syncDmDevices).toHaveBeenCalledWith('dm', 'open');
  act(() => jest.advanceTimersByTime(30 * 60_000));
  expect(syncDmDevices).toHaveBeenCalledTimes(1);
  act(() => {
    blur?.();
    blur = mockFocus();
    jest.advanceTimersByTime(DM_DEVICE_SYNC_OPEN_DELAY_MS);
  });
  expect(syncDmDevices).toHaveBeenCalledTimes(2);
  act(() => {
    blur?.();
    blur = mockFocus();
    blur?.();
    jest.advanceTimersByTime(DM_DEVICE_SYNC_OPEN_DELAY_MS);
  });
  expect(syncDmDevices).toHaveBeenCalledTimes(2);
});
