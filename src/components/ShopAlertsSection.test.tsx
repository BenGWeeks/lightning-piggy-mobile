import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import ShopAlertsSection from './ShopAlertsSection';
import Toast from './BrandedToast';
import { lightPalette as mockPalette } from '../styles/palettes';
import { DEFAULT_NEARBY_SETTINGS, loadNearbySettings } from '../services/nearbySettingsService';
import { disableGeofencing, enableGeofencing } from '../services/geofenceService';

let mockActive = false;
jest.mock('../services/geofenceService', () => ({
  isGeofencingActive: jest.fn(async () => mockActive),
  enableGeofencing: jest.fn(async () => {
    mockActive = true;
    return 3;
  }),
  disableGeofencing: jest.fn(async () => {
    mockActive = false;
  }),
}));
jest.mock('expo-location', () => ({
  hasServicesEnabledAsync: jest.fn(async () => true),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
}));
jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('../contexts/ThemeContext', () => ({ useThemeColors: () => mockPalette }));
jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (key: string) => key }));
jest.mock('./BrandedToast', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('./SettingsRow', () => ({
  __esModule: true,
  default: ({
    toggle,
    subtitle,
    testID,
  }: {
    toggle?: object;
    subtitle?: string;
    testID: string;
  }) => {
    const React = jest.requireActual('react');
    const { View, Text } = jest.requireActual('react-native');
    return React.createElement(
      View,
      null,
      React.createElement(Text, { testID: `${testID}-subtitle` }, subtitle),
      toggle && React.createElement(View, toggle),
    );
  },
}));
jest.mock('lucide-react-native', () => ({ MapPin: () => null }));

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockActive = false;
});

it.each([false, true])(
  'rolls back a failed master save with previous enabled=%s',
  async (enabled) => {
    mockActive = enabled;
    await AsyncStorage.setItem(
      'nearby-settings:v1',
      JSON.stringify({ ...DEFAULT_NEARBY_SETTINGS, enabled }),
    );
    const ui = render(<ShopAlertsSection />);
    await waitFor(() => {
      expect(ui.getByTestId('settings-nearby-merchants-toggle').props.value).toBe(enabled);
      expect(ui.getByTestId('shop-alerts-enabled-subtitle').props.children).toBe(
        enabled ? 'notificationSettingsScreen.on' : 'notificationSettingsScreen.off',
      );
    });
    // Flush the initial settings read even when defaults already match.
    await act(async () => {});
    let rejectSave!: (error: Error) => void;
    (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => (rejectSave = reject)),
    );
    let work!: Promise<void>;
    act(() => {
      work = ui.getByTestId('settings-nearby-merchants-toggle').props.onValueChange(!enabled);
    });
    expect(ui.getByTestId('settings-nearby-merchants-toggle').props.value).toBe(!enabled);
    await waitFor(() => expect(mockActive).toBe(!enabled));
    await act(async () => {
      rejectSave(new Error('disk full'));
      await work;
    });

    expect(ui.getByTestId('settings-nearby-merchants-toggle').props.value).toBe(enabled);
    expect(ui.getByTestId('settings-nearby-merchants-toggle').props.pending).toBe(false);
    expect(mockActive).toBe(enabled);
    expect(await loadNearbySettings()).toMatchObject({ enabled });
    expect(enableGeofencing).toHaveBeenCalledTimes(1);
    expect(disableGeofencing).toHaveBeenCalledTimes(1);
    expect(ui.getByTestId('shop-alerts-enabled-subtitle').props.children).toBe(
      enabled ? 'notificationSettingsScreen.on' : 'notificationSettingsScreen.off',
    );
    expect(Toast.show).toHaveBeenCalledTimes(1);
    expect(Toast.show).toHaveBeenCalledWith({
      type: 'error',
      text1: 'notificationSettingsScreen.updateFailed',
    });
  },
);
