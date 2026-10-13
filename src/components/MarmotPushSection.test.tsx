import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';

import MarmotPushSection from './MarmotPushSection';
import Toast from './BrandedToast';
import { lightPalette as mockPalette } from '../styles/palettes';
import { disableMarmotPush } from '../services/marmotPushRegistration';
import { unregisterWatcherPush } from '../services/watcherPush';

jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({ pubkey: 'account', signerType: 'nsec' }),
}));
jest.mock('../contexts/ThemeContext', () => ({ useThemeColors: () => mockPalette }));
jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (key: string) => key }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('../services/marmotPushRegistration', () => ({
  loadMarmotPushSettings: jest.fn(async () => ({ enabled: true, otherAccounts: false })),
  pendingMarmotPushGroups: jest.fn(async () => 0),
  subscribeMarmotPushStatus: jest.fn(() => jest.fn()),
  disableMarmotPush: jest.fn(),
}));
jest.mock('../services/watcherPush', () => ({
  unregisterWatcherPush: jest.fn(async () => true),
}));
jest.mock('./BrandedToast', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('./SettingsRow', () => ({
  __esModule: true,
  default: ({
    toggle,
    subtitle,
    subtitleTestID,
  }: {
    toggle?: object;
    subtitle?: string;
    subtitleTestID?: string;
  }) => {
    const React = jest.requireActual('react');
    const { View, Text } = jest.requireActual('react-native');
    return React.createElement(
      View,
      null,
      React.createElement(Text, { testID: subtitleTestID }, subtitle),
      toggle && React.createElement(View, toggle),
    );
  },
}));
jest.mock('./WatcherPushSection', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('lucide-react-native', () => ({ Smartphone: () => null }));

beforeEach(() => jest.clearAllMocks());

it.each([true, false])(
  'keeps push off and reports a failed preference save with tokenDeleted=%s',
  async (tokenDeleted) => {
    (disableMarmotPush as jest.Mock).mockResolvedValueOnce({
      saved: false,
      tokenDeleted,
      sync: null,
    });
    const ui = render(<MarmotPushSection />);
    await waitFor(() =>
      expect(ui.getByTestId('security-marmot-push-toggle').props.value).toBe(true),
    );

    await act(async () => {
      await ui.getByTestId('security-marmot-push-toggle').props.onValueChange(false);
    });

    expect(unregisterWatcherPush).toHaveBeenCalledTimes(1);
    expect(disableMarmotPush).toHaveBeenCalledWith('account', { stillRegistered: false });
    expect(ui.getByTestId('security-marmot-push-toggle').props.value).toBe(false);
    expect(ui.getByTestId('security-marmot-push-toggle').props.pending).toBe(false);
    expect(ui.getByTestId('security-marmot-push-status').props.children).toBe(
      'notificationSettingsScreen.off',
    );
    expect(Toast.show).toHaveBeenCalledTimes(1);
    expect(Toast.show).toHaveBeenCalledWith({
      type: 'error',
      text1: 'securityScreen.marmotPushSaveFailed',
    });
  },
);
