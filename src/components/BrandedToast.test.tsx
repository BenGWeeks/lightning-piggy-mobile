import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { BrandedToast, GenericBrandedToast } from './BrandedToast';

jest.mock('../contexts/ThemeContext', () => ({
  useThemeColors: () => ({
    brandPink: 'pink',
    surface: 'white',
    textHeader: 'black',
    textBody: 'black',
  }),
}));
jest.mock('react-native-toast-message', () => {
  const React = jest.requireActual('react');
  const { View, TouchableOpacity, Text } = jest.requireActual('react-native');
  const Toast = Object.assign(
    ({ onPress, swipeable }: { onPress: () => void; swipeable: boolean }) =>
      React.createElement(
        View,
        { testID: 'toast-host', swipeable },
        React.createElement(
          TouchableOpacity,
          { onPress, testID: 'toast-tap' },
          React.createElement(Text, null, 'Toast'),
        ),
      ),
    { hide: jest.fn(), show: jest.fn() },
  );
  return { __esModule: true, default: Toast, BaseToast: View, ErrorToast: View, InfoToast: View };
});

it('dismisses on tap and explicitly retains the library swipe-to-hide gesture', () => {
  const screen = render(<BrandedToast />);
  expect(screen.getByTestId('toast-host').props.swipeable).toBe(true);
  fireEvent.press(screen.getByTestId('toast-tap'));
  expect(jest.requireMock('react-native-toast-message').default.hide).toHaveBeenCalled();
});

it('also dismisses the generic branded card on tap', () => {
  jest.requireMock('react-native-toast-message').default.hide.mockClear();
  const screen = render(<GenericBrandedToast text1="Complete" />);
  fireEvent.press(screen.getByRole('button', { name: 'Complete' }));
  expect(jest.requireMock('react-native-toast-message').default.hide).toHaveBeenCalledTimes(1);
});
