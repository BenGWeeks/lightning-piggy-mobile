import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import ContactListItem from './ContactListItem';
import SendActionButtons from './SendActionButtons';
import SendWalletSelector from './SendWalletSelector';
import type { SendSheetStyles } from '../styles/SendSheet.styles';
import type { WalletState } from '../types/wallet';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
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

it('keeps profile, message and zap independently reachable without triggering the profile action', () => {
  const onPress = jest.fn(),
    onMessage = jest.fn(),
    onZap = jest.fn();
  render(
    <ContactListItem
      name="Ada"
      onPress={onPress}
      onMessage={onMessage}
      onZap={onZap}
      canMessage
      canZap
    />,
  );
  expect(screen.getAllByRole('button')).toHaveLength(3);
  fireEvent.press(screen.getByRole('button', { name: 'Message Ada' }));
  expect(onMessage).toHaveBeenCalledTimes(1);
  expect(onPress).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Zap Ada' }));
  expect(onZap).toHaveBeenCalledTimes(1);
  expect(onPress).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Ada' }));
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('does not announce a profile button without a handler and prevents disabled messaging', () => {
  const onMessage = jest.fn();
  render(
    <ContactListItem
      name="Ada"
      onMessage={onMessage}
      showZap={false}
      testID="contact-profile-target"
    />,
  );
  expect(screen.queryByRole('button', { name: 'Ada' })).toBeNull();
  expect(screen.getByTestId('contact-profile-target').props.accessibilityRole).toBe('text');
  const message = screen.getByRole('button', { disabled: true });
  expect(message.props.accessibilityLabel).toBe('Message Ada (no Nostr key)');
  fireEvent.press(message);
  expect(onMessage).not.toHaveBeenCalled();
});

const styles = new Proxy({}, { get: () => ({}) }) as SendSheetStyles;
const colors = { brandPink: '#000', white: '#fff' };
it('exposes send disabled and busy state, preserving cancel and preventing disabled payments', () => {
  const handleSend = jest.fn(),
    onCancel = jest.fn();
  const view = render(
    <SendActionButtons
      canSend={false}
      sending={false}
      handleSend={handleSend}
      onCancel={onCancel}
      styles={styles}
      colors={colors}
    />,
  );
  fireEvent.press(screen.getByRole('button', { name: 'Send', disabled: true }));
  expect(handleSend).not.toHaveBeenCalled();
  view.rerender(
    <SendActionButtons
      canSend
      sending={false}
      handleSend={handleSend}
      onCancel={onCancel}
      styles={styles}
      colors={colors}
    />,
  );
  fireEvent.press(screen.getByRole('button', { name: 'Send', disabled: false }));
  expect(handleSend).toHaveBeenCalledTimes(1);
  view.rerender(
    <SendActionButtons
      canSend
      sending
      handleSend={handleSend}
      onCancel={onCancel}
      styles={styles}
      colors={colors}
    />,
  );
  fireEvent.press(screen.getByRole('button', { name: 'Send', disabled: true, busy: true }));
  expect(handleSend).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});

it('gives duplicate wallet aliases distinct selectors and reports the selected wallet', () => {
  const wallets = [
    { id: 'A', alias: 'Savings', isConnected: true },
    { id: 'B', alias: 'Savings', isConnected: true },
  ] as WalletState[];
  const setCapturedWalletId = jest.fn(),
    setDropdownOpen = jest.fn();
  render(
    <SendWalletSelector
      wallets={wallets}
      walletName="Savings"
      capturedWalletId="A"
      dropdownOpen
      setCapturedWalletId={setCapturedWalletId}
      setDropdownOpen={setDropdownOpen}
      styles={styles}
      colors={colors}
    />,
  );
  expect(screen.getByTestId('send-wallet-selector').props.accessibilityState.expanded).toBe(true);
  expect(screen.getByTestId('send-wallet-option-A').props.accessibilityState.selected).toBe(true);
  expect(screen.getByTestId('send-wallet-option-B').props.accessibilityState.selected).toBe(false);
  fireEvent.press(screen.getByTestId('send-wallet-option-B'));
  expect(setCapturedWalletId).toHaveBeenCalledWith('B');
  expect(setDropdownOpen).toHaveBeenCalledWith(false);
});
