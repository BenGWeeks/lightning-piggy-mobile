import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import AddFriendSheet from './AddFriendSheet';

jest.mock('@gorhom/bottom-sheet', () => {
  const R = jest.requireActual('react');
  const RN = jest.requireActual('react-native');
  const Pass = ({ children }: { children?: React.ReactNode }) =>
    R.createElement(RN.View, null, children);
  return {
    BottomSheetModal: R.forwardRef(function Modal(
      { children }: { children?: React.ReactNode },
      ref: React.Ref<unknown>,
    ) {
      R.useImperativeHandle(ref, () => ({ present: jest.fn(), dismiss: jest.fn() }));
      return R.createElement(RN.View, null, children);
    }),
    BottomSheetBackdrop: () => null,
    BottomSheetScrollView: Pass,
    BottomSheetTextInput: RN.TextInput,
  };
});
jest.mock('expo-camera', () => ({
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
  CameraView: () => null,
}));
jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn().mockResolvedValue('npub1public') }));
jest.mock('./BrandedAlert', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('../contexts/ThemeContext', () => ({
  useThemeColors: () => new Proxy({}, { get: () => '#000' }),
}));
jest.mock('../contexts/LocaleContext', () => ({
  useTranslation: () => (key: string) =>
    key
      .split('.')
      .reduce<unknown>(
        (value, part) => (value as Record<string, unknown>)[part],
        jest.requireActual('../i18n/locales/en.json'),
      ) as string,
}));

it('announces which paste/scan tab is selected after switching modes', async () => {
  render(<AddFriendSheet visible onClose={jest.fn()} onAdd={jest.fn()} />);
  expect(screen.getByRole('tab', { selected: true }).props.testID).toBe('add-friend-tab-paste');
  await act(async () => fireEvent.press(screen.getByRole('tab', { name: 'Scan QR' })));
  expect(screen.getByRole('tab', { selected: true }).props.testID).toBe('add-friend-tab-scan');
  expect(screen.getByRole('tab', { selected: false }).props.testID).toBe('add-friend-tab-paste');
});

it('tracks disabled/busy state through validation and submission and prevents duplicate presses', async () => {
  let finish: (success: boolean) => void = () => {};
  const onAdd = jest.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
  const onClose = jest.fn();
  render(<AddFriendSheet visible onClose={onClose} onAdd={onAdd} />);
  expect(screen.getByRole('button', { name: 'Add Friend', disabled: true })).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('npub-input'), 'npub1public');
  fireEvent.press(screen.getByRole('button', { name: 'Add Friend', disabled: false }));
  expect(
    screen.getByRole('button', { name: 'Add Friend', busy: true, disabled: true }),
  ).toBeTruthy();
  fireEvent.press(screen.getByTestId('add-friend-submit'));
  expect(onAdd).toHaveBeenCalledTimes(1);
  await act(async () => finish(true));
  expect(
    screen.getByRole('button', { name: 'Add Friend', busy: false, disabled: false }),
  ).toBeTruthy();
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('labels the paste button and fills the public-key input', async () => {
  render(<AddFriendSheet visible onClose={jest.fn()} onAdd={jest.fn()} />);
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Paste npub' })));
  expect(screen.getByTestId('npub-input').props.value).toBe('npub1public');
});
