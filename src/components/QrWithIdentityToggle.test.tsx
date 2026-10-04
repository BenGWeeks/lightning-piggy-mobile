import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import QrWithIdentityToggle from './QrWithIdentityToggle';

jest.mock('react-native-qrcode-svg', () => () => null);
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('./BrandedToast', () => ({ show: jest.fn() }));
jest.mock('../contexts/ThemeContext', () => ({
  useThemeColors: () => new Proxy({}, { get: () => '#000' }),
}));
jest.mock('../contexts/LocaleContext', () => ({
  useTranslation:
    () =>
    (key: string, params: Record<string, string> = {}) => {
      const en = jest.requireActual('../i18n/locales/en.json');
      const text = key.split('.').reduce((value, part) => value[part], en);
      return text.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => params[name]);
    },
}));

beforeEach(() => jest.clearAllMocks());

it('updates selected QR tabs and the named copy action together', async () => {
  render(<QrWithIdentityToggle npub="npub1public" lightningAddress="piggy@example.com" />);
  expect(screen.getByRole('tab', { selected: true }).props.testID).toBe('profile-qr-toggle-npub');
  fireEvent.press(screen.getByTestId('profile-qr-toggle-lightning'));
  expect(screen.getByRole('tab', { selected: true }).props.testID).toBe(
    'profile-qr-toggle-lightning',
  );
  expect(screen.getByRole('tab', { selected: false }).props.testID).toBe('profile-qr-toggle-npub');
  await act(async () => fireEvent.press(screen.getByTestId('profile-qr-copy-button')));
  expect(screen.getAllByRole('button', { name: 'Copy Lightning address' })).toHaveLength(2);
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('piggy@example.com');
});

it('announces unsupported NFC as disabled and prevents the action', () => {
  const onNfcWrite = jest.fn();
  render(<QrWithIdentityToggle npub="npub1public" onNfcWrite={onNfcWrite} />);
  const button = screen.getByRole('button', { disabled: true });
  expect(button.props.accessibilityLabel).toBe('NFC not supported on this device');
  fireEvent.press(button);
  expect(onNfcWrite).not.toHaveBeenCalled();
});

it('omits unavailable Lightning tabs and names the public QR image', () => {
  render(<QrWithIdentityToggle npub="npub1public" defaultMode="lightning" />);
  expect(screen.queryAllByRole('tab')).toHaveLength(0);
  expect(screen.getByRole('image').props.accessibilityLabel).toBe('QR code for your npub');
});
