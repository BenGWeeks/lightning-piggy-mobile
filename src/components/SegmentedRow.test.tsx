import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Settings } from 'lucide-react-native';
import SegmentedRow from './SegmentedRow';

jest.mock('../contexts/ThemeContext', () => ({
  useThemeColors: () => jest.requireActual('../styles/palettes').darkPalette,
}));
jest.mock('../contexts/LocaleContext', () => ({
  useTranslation: () => (key: string) => key,
}));
jest.mock('./SettingsInfoSheet', () => ({ __esModule: true, default: () => null }));

const reason = 'Connect a wallet to change this setting';
const options = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
] as const;

afterEach(() => jest.restoreAllMocks());

it('shows the disabled explanation for fitting labels at normal text size and hints every radio', () => {
  const native = jest.requireActual<typeof import('react-native')>('react-native');
  jest.spyOn(native, 'useWindowDimensions').mockReturnValue({
    width: 400,
    height: 800,
    scale: 1,
    fontScale: 1,
  });
  const onValueChange = jest.fn();
  const screen = render(
    <SegmentedRow
      icon={Settings}
      title="Notifications"
      options={options}
      value="on"
      onValueChange={onValueChange}
      testID="notifications"
      disabled
      disabledSubtitle={reason}
    />,
  );

  expect(screen.getByText(reason)).toBeTruthy();
  for (const option of options) {
    const radio = screen.getByTestId(`notifications-option-${option.value}`);
    expect(radio.props.accessibilityHint).toBe(reason);
    expect(radio.props.accessibilityState.disabled).toBe(true);
    fireEvent.press(radio);
  }
  expect(onValueChange).not.toHaveBeenCalled();

  screen.rerender(
    <SegmentedRow
      icon={Settings}
      title="Notifications"
      options={options}
      value="on"
      onValueChange={onValueChange}
      testID="notifications"
      disabledSubtitle={reason}
    />,
  );
  expect(screen.queryByText(reason)).toBeNull();
  for (const radio of screen.getAllByRole('radio')) {
    expect(radio.props.accessibilityHint).toBeUndefined();
  }
  fireEvent.press(screen.getByTestId('notifications-option-off'));
  expect(onValueChange).toHaveBeenCalledWith('off');
});
