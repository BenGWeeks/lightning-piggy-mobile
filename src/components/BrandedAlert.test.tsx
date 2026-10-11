import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, BrandedAlertHost } from './BrandedAlert';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('../contexts/ThemeContext', () => ({
  useThemeColors: () => new Proxy({}, { get: () => '#000' }),
}));

describe('BrandedAlertHost', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('dismisses a displaced alert when a new one replaces it', () => {
    const firstDismiss = jest.fn();
    const secondDismiss = jest.fn();
    render(<BrandedAlertHost />);

    act(() => {
      Alert.alert('Share location?', undefined, [{ text: 'Cancel', style: 'cancel' }], {
        onDismiss: firstDismiss,
      });
    });
    act(() => {
      Alert.alert('Send failed', 'Try again', undefined, { onDismiss: secondDismiss });
    });

    // Deferred so the replacement has rendered before callers react.
    expect(firstDismiss).not.toHaveBeenCalled();
    act(() => jest.runAllTimers());
    expect(firstDismiss).toHaveBeenCalledTimes(1);
    expect(secondDismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId('branded-alert-title')).toHaveTextContent('Send failed');
  });

  it('lets a caller retry after its confirmation was replaced', () => {
    // Mirrors the consent-promise pattern: a guard stays set until the
    // dialog settles (button press or dismissal).
    let pending = false;
    const ask = () => {
      if (pending) return false;
      pending = true;
      Alert.alert(
        'Share location?',
        undefined,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => (pending = false) },
          { text: 'Share', onPress: () => (pending = false) },
        ],
        { onDismiss: () => (pending = false) },
      );
      return true;
    };
    render(<BrandedAlertHost />);

    act(() => {
      ask();
    });
    act(() => Alert.alert('Send failed'));
    act(() => jest.runAllTimers());
    expect(pending).toBe(false);

    let retried = false;
    act(() => {
      retried = ask();
    });
    expect(retried).toBe(true);
    expect(screen.getByTestId('branded-alert-title')).toHaveTextContent('Share location?');
  });

  it('does not call onDismiss when a button closes the alert', () => {
    const onDismiss = jest.fn();
    const onPress = jest.fn();
    render(<BrandedAlertHost />);

    act(() => Alert.alert('Saved', undefined, [{ text: 'OK', onPress }], { onDismiss }));
    fireEvent.press(screen.getByTestId('branded-alert-button-0'));
    act(() => Alert.alert('Next'));
    act(() => jest.runAllTimers());

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
