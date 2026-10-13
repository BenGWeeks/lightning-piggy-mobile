import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import SecurityScreen from './SecurityScreen';
import { getSendThreshold, setSendThreshold } from '../../services/sendThresholdService';
import { Toast } from '../../components/BrandedToast';

let mockSelect: (value: string) => void;
const mockOpenPicker = jest.fn();
jest.mock('../../hooks/useSettingsPicker', () => ({
  useSettingsPicker: (_owner: string, onSelect: (value: string) => void) => {
    mockSelect = onSelect;
    return mockOpenPicker;
  },
}));

jest.mock('./AccountScreenLayout', () => {
  const Layout = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  Layout.displayName = 'AccountScreenLayout';
  return Layout;
});
jest.mock('./sharedStyles', () => ({ createSharedAccountStyles: () => ({}) }));
jest.mock('../../styles/SecurityScreen.styles', () => ({ createSecurityScreenStyles: () => ({}) }));
jest.mock('../../contexts/ThemeContext', () => ({ useThemeColors: () => ({}) }));
jest.mock('../../contexts/LocaleContext', () => ({
  useTranslation: () => (key: string) => key,
}));
jest.mock('../../contexts/NostrContext', () => ({ useNostr: () => ({ pubkey: 'a'.repeat(64) }) }));
jest.mock('../../components/MarmotPushSection', () => () => null);
jest.mock('../../components/SettingsInfoSheet', () => {
  const Sheet = ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? <>{children}</> : null;
  return Sheet;
});
jest.mock('../../components/KeyBackupEntry', () => () => null);
jest.mock('../../components/BrandedToast', () => ({ Toast: { show: jest.fn() } }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('../../services/sendThresholdService', () => ({
  DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS: 10_000,
  getSendThreshold: jest.fn(async () => 10_000),
  setSendThreshold: jest.fn(),
}));
jest.mock('../../services/linkPreviewPreference', () => ({
  getLinkPreviewEnabled: jest.fn(async () => true),
  setLinkPreviewEnabled: jest.fn(async () => {}),
}));
jest.mock('../../services/notificationService', () => ({
  getLockScreenContentEnabled: jest.fn(async () => false),
  setLockScreenContentEnabled: jest.fn(async () => {}),
  requestNotificationPermission: jest.fn(async () => true),
}));
jest.mock('../../services/backgroundDmPreference', () => ({
  loadBackgroundDmEnabled: jest.fn(async () => false),
  setBackgroundDmEnabled: jest.fn(async () => {}),
}));
jest.mock('../../services/backgroundDmService', () => ({
  startBackgroundDmWatch: jest.fn(async () => {}),
  stopBackgroundDmWatch: jest.fn(async () => {}),
}));

beforeEach(() => jest.clearAllMocks());

it('keeps Custom as a draft until blur and saves it for the active account', async () => {
  const ui = render(<SecurityScreen />);
  await act(async () => {});
  act(() => mockSelect('custom'));
  const input = ui.getByTestId('security-threshold-custom-input');
  fireEvent.changeText(input, '25000');
  expect(setSendThreshold).not.toHaveBeenCalled();
  await act(async () => fireEvent(input, 'blur'));
  expect(setSendThreshold).toHaveBeenCalledWith(25000, 'a'.repeat(64));
});

it('does not save an empty or zero Custom draft on blur', async () => {
  const ui = render(<SecurityScreen />);
  await act(async () => {});
  act(() => mockSelect('custom'));
  const input = ui.getByTestId('security-threshold-custom-input');
  await act(async () => fireEvent(input, 'blur'));
  fireEvent.changeText(input, '0');
  await act(async () => fireEvent(input, 'blur'));
  expect(setSendThreshold).not.toHaveBeenCalled();
});

it('a failed threshold save is caught: toast, and the stored value is shown again', async () => {
  (setSendThreshold as jest.Mock).mockRejectedValueOnce(new Error('locked registry'));
  const ui = render(<SecurityScreen />);
  await waitFor(() => expect(getSendThreshold).toHaveBeenCalled());
  await act(async () => {
    mockSelect('off');
  });
  expect(Toast.show).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'error', text1: 'securityScreen.thresholdSaveFailed' }),
  );
  // Reopening the picker shows the stored preset after the failed save.
  fireEvent.press(ui.getByTestId('security-confirm-large-payments'));
  expect(mockOpenPicker).toHaveBeenLastCalledWith(
    expect.objectContaining({ selectedValue: '10000' }),
  );
});

it('says once, in the scope header, that these settings follow the account', () => {
  const ui = render(<SecurityScreen />);
  expect(ui.getAllByText('settingsScope.forThisAccount')).toHaveLength(1);
});
