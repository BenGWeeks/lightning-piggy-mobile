import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { registerPickerOptions } from '../../utils/settingsPicker';
import PickerScreen from './PickerScreen';

jest.mock('./AccountScreenLayout', () => {
  const Layout = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  Layout.displayName = 'AccountScreenLayout';
  return Layout;
});
jest.mock('../../contexts/ThemeContext', () => ({
  useThemeColors: () => jest.requireActual('../../styles/palettes').darkPalette,
}));
jest.mock('../../contexts/LocaleContext', () => ({
  useTranslation: () => (key: string) => key,
}));

type Props = NativeStackScreenProps<RootStackParamList, 'SettingsPicker'>;
const savedRoute: Props['route'] = {
  key: 'saved-picker',
  name: 'SettingsPicker',
  params: {
    title: 'Theme',
    registryKey: 'saved-theme',
    testID: 'theme-picker',
    customOption: { value: 'custom' },
    returnTo: { routeKey: 'settings', navigatorKey: 'root', param: 'theme' },
  },
};

function restorePicker(canGoBack = true, params = savedRoute.params) {
  const navigation = {
    canGoBack: jest.fn(() => canGoBack),
    goBack: jest.fn(),
    replace: jest.fn(),
    dispatch: jest.fn(),
  };
  // Persisted route data survives process death, while registrations do not.
  const route = JSON.parse(JSON.stringify({ ...savedRoute, params })) as Props['route'];
  const ui = render(
    <PickerScreen route={route} navigation={navigation as unknown as Props['navigation']} />,
  );
  return { ui, navigation };
}

it('leaves a restored picker with an unavailable registry key without showing options', () => {
  const { ui, navigation } = restorePicker();
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
  expect(navigation.replace).not.toHaveBeenCalled();
  expect(navigation.dispatch).not.toHaveBeenCalled();
  expect(ui.queryByTestId('theme-picker')).toBeNull();
  expect(ui.queryByText('settingsKit.noResults')).toBeNull();
});

it('replaces an orphaned restored picker with Home when there is no back route', () => {
  const { ui, navigation } = restorePicker(false);
  expect(navigation.goBack).not.toHaveBeenCalled();
  expect(navigation.replace).toHaveBeenCalledWith('Main', {
    screen: 'MainTabs',
    params: { screen: 'Home' },
  });
  expect(ui.queryByTestId('theme-picker')).toBeNull();
});

it('keeps a valid empty registration open', () => {
  const release = registerPickerOptions('saved-theme', []);
  try {
    const { ui, navigation } = restorePicker();
    expect(ui.getByTestId('theme-picker-option-custom')).toBeTruthy();
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
  } finally {
    release();
  }
});

it('restores serializable options and delivers selections to the original caller', () => {
  const { title, testID, customOption, returnTo } = savedRoute.params;
  const { ui, navigation } = restorePicker(true, {
    title,
    testID,
    customOption,
    returnTo,
    options: [{ value: 'dark', label: 'Dark' }],
  });
  expect(navigation.goBack).not.toHaveBeenCalled();
  fireEvent.press(ui.getByTestId('theme-picker-option-dark'));
  expect(navigation.dispatch).toHaveBeenCalledWith({
    type: 'SET_PARAMS',
    payload: { params: { theme: 'dark' } },
    source: 'settings',
    target: 'root',
  });
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
});
