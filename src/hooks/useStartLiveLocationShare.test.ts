import { act, renderHook } from '@testing-library/react-native';
import { Alert } from '../components/BrandedAlert';
import { getCurrentLocation } from '../services/locationService';
import { useStartLiveLocationShare } from './useStartLiveLocationShare';

const mockStartShare = jest.fn();
jest.mock('../contexts/LiveLocationContext', () => ({
  useLiveLocation: () => ({ startShare: mockStartShare }),
}));
jest.mock('../components/BrandedAlert', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('../services/locationService', () => ({
  ...jest.requireActual('../services/locationService'),
  getCurrentLocation: jest.fn(),
}));
const alert = jest.mocked(Alert.alert);
const getLocation = jest.mocked(getCurrentLocation);
const location = { lat: 51.5074, lon: -0.1278, accuracyMeters: 5 };

function setup() {
  const closePicker = jest.fn();
  const appendOptimisticLocal = jest.fn();
  const { result } = renderHook(() =>
    useStartLiveLocationShare({
      name: 'Big Piggy',
      pubkey: 'big',
      protocol: 'nip17',
      closePicker,
      appendOptimisticLocal,
    }),
  );
  return { result, closePicker, appendOptimisticLocal };
}

beforeEach(() => {
  jest.clearAllMocks();
  getLocation.mockResolvedValue({ ok: true, location });
  mockStartShare.mockResolvedValue({ ok: true, markerText: 'published marker' });
});

it.each(['cancel', 'dismiss', 'share'])('%s gates live session startup', async (action) => {
  const { result, closePicker, appendOptimisticLocal } = setup();
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current(900000);
  });
  expect(closePicker).toHaveBeenCalledTimes(1);
  expect(mockStartShare).not.toHaveBeenCalled();
  expect(appendOptimisticLocal).not.toHaveBeenCalled();
  expect(alert.mock.calls[0][0]).toBe('Share your live location with Big Piggy?');
  await act(async () => {
    if (action === 'dismiss') alert.mock.calls[0][3]!.onDismiss!();
    else alert.mock.calls[0][2]![action === 'share' ? 1 : 0].onPress!();
    await pending;
  });
  if (action === 'share') {
    expect(mockStartShare).toHaveBeenCalledWith('big', 900000, 'nip17');
    expect(appendOptimisticLocal).toHaveBeenCalledWith('published marker');
  } else {
    expect(mockStartShare).not.toHaveBeenCalled();
    expect(appendOptimisticLocal).not.toHaveBeenCalled();
  }
});

it('does not start when location is unavailable', async () => {
  getLocation.mockResolvedValue({ ok: false, error: 'permission_denied', message: 'Denied' });
  const { result } = setup();
  await act(async () => {
    await result.current(900000);
  });
  expect(mockStartShare).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith(expect.any(String), 'Denied');
});

it('prevents overlapping starts and permits retry after cancellation', async () => {
  const { result } = setup();
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current(900000);
    await result.current(900000);
  });
  expect(alert).toHaveBeenCalledTimes(1);
  await act(async () => {
    alert.mock.calls[0][2]![0].onPress!();
    await pending;
  });
  await act(async () => {
    pending = result.current(900000);
  });
  expect(alert).toHaveBeenCalledTimes(2);
  await act(async () => {
    alert.mock.calls[1][2]![0].onPress!();
    await pending;
  });
});

it('reports provider failure without appending a live marker', async () => {
  mockStartShare.mockResolvedValue({ ok: false, error: 'Send failed' });
  const { result, appendOptimisticLocal } = setup();
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current(900000);
  });
  await act(async () => {
    alert.mock.calls[0][2]![1].onPress!();
    await pending;
  });
  expect(alert).toHaveBeenLastCalledWith(expect.any(String), 'Send failed');
  expect(appendOptimisticLocal).not.toHaveBeenCalled();
});
