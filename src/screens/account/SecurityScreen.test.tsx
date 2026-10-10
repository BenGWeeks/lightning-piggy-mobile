import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import SecurityScreen from './SecurityScreen';
import { getSendThreshold, setSendThreshold } from '../../services/sendThresholdService';
import { Toast } from '../../components/BrandedToast';

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
jest.mock('../../components/KeyBackupEntry', () => () => null);
jest.mock('../../components/DetailsDisclosure', () => () => null);
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

it('a failed threshold save is caught: toast, and the stored value is shown again', async () => {
  (setSendThreshold as jest.Mock).mockRejectedValueOnce(new Error('locked registry'));
  const ui = render(<SecurityScreen />);
  await waitFor(() => expect(getSendThreshold).toHaveBeenCalled());
  await act(async () => {
    fireEvent.press(ui.getByTestId('security-threshold-off'));
  });
  expect(Toast.show).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'error', text1: 'securityScreen.thresholdSaveFailed' }),
  );
  // Back on the saved 10k preset, not the unsaved "Off".
  expect(ui.getByTestId('security-threshold-10000').props.accessibilityState).toEqual({
    selected: true,
  });
  expect(ui.getByTestId('security-threshold-off').props.accessibilityState).toEqual({
    selected: false,
  });
});

it('shows the per-account hint once, not under every section', () => {
  const ui = render(<SecurityScreen />);
  expect(ui.getAllByText('securityScreen.perAccountHint')).toHaveLength(1);
});
