import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { UserLocationProvider, useUserLocation } from './UserLocationContext';

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
  Accuracy: { High: 4 },
}));

const location = jest.mocked(Location);
const removeWatch = jest.fn();
const fix = {
  coords: { latitude: 51.5, longitude: -0.12, accuracy: 10 },
  timestamp: 1000,
} as Location.LocationObject;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <UserLocationProvider>{children}</UserLocationProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  location.requestForegroundPermissionsAsync.mockResolvedValue({
    status: 'granted',
  } as Location.LocationPermissionResponse);
  location.getLastKnownPositionAsync.mockResolvedValue(fix);
  location.getCurrentPositionAsync.mockResolvedValue(fix);
  location.watchPositionAsync.mockResolvedValue({ remove: removeWatch });
});

it('keeps passive conversation consumers GPS-cold across renders and unmount', async () => {
  const { result, rerender, unmount } = renderHook(() => useUserLocation({ enabled: false }), {
    wrapper,
  });
  await act(async () => rerender({}));
  expect(result.current.pos).toBeNull();
  unmount();
  expect(location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(location.getLastKnownPositionAsync).not.toHaveBeenCalled();
  expect(location.getCurrentPositionAsync).not.toHaveBeenCalled();
  expect(location.watchPositionAsync).not.toHaveBeenCalled();
});

it('still requests permission and watches when location is explicitly enabled', async () => {
  const { result, rerender } = renderHook(
    ({ enabled }: { enabled: boolean }) => useUserLocation({ enabled }),
    {
      wrapper,
      initialProps: { enabled: false },
    },
  );
  expect(location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  rerender({ enabled: true });
  await waitFor(() => expect(result.current.pos).toEqual({ lat: 51.5, lon: -0.12, accuracy: 10 }));
  expect(location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(location.watchPositionAsync).toHaveBeenCalledTimes(1);
  rerender({ enabled: false });
  expect(removeWatch).toHaveBeenCalledTimes(1);
});

it('lets passive consumers read a fix without keeping an active consumer’s watch alive', async () => {
  const { result, rerender } = renderHook(
    ({ active }: { active: boolean }) => {
      useUserLocation({ enabled: active });
      return useUserLocation({ enabled: false });
    },
    { wrapper, initialProps: { active: true } },
  );
  await waitFor(() => expect(result.current.pos).toEqual({ lat: 51.5, lon: -0.12, accuracy: 10 }));
  expect(location.watchPositionAsync).toHaveBeenCalledTimes(1);
  rerender({ active: false });
  expect(removeWatch).toHaveBeenCalledTimes(1);
  expect(location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(location.watchPositionAsync).toHaveBeenCalledTimes(1);
});

it('preserves the default active consumer and handles permission denial without GPS', async () => {
  location.requestForegroundPermissionsAsync.mockResolvedValue({
    status: 'denied',
  } as Location.LocationPermissionResponse);
  const { result } = renderHook(() => useUserLocation(), { wrapper });
  await waitFor(() => expect(result.current.denied).toBe(true));
  expect(location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(location.getCurrentPositionAsync).not.toHaveBeenCalled();
  expect(location.watchPositionAsync).not.toHaveBeenCalled();
});
