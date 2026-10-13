import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import ProfileErrorBoundary from './ProfileErrorBoundary';

jest.mock('../contexts/ThemeContext', () => ({ useThemeColors: () => ({ brandPink: 'pink' }) }));
jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (key: string) => key }));
jest.mock('lucide-react-native', () => ({ UserRound: () => null }));

it('renders a valid profile normally', () => {
  const view = render(
    <ProfileErrorBoundary>
      <Text>Alice</Text>
    </ProfileErrorBoundary>,
  );
  expect(view.getByText('Alice')).toBeTruthy();
  expect(view.queryByTestId('profile-error-fallback')).toBeNull();
});
it('contains a malformed profile and keeps sibling content visible', () => {
  function Broken(): React.ReactNode {
    throw new Error('malformed profile');
  }
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const view = render(
      <>
        <Text>Screen content</Text>
        <ProfileErrorBoundary>
          <Broken />
        </ProfileErrorBoundary>
      </>,
    );
    expect(view.getByText('Screen content')).toBeTruthy();
    expect(view.getByText('profileSafety.unavailable')).toBeTruthy();
  } finally {
    log.mockRestore();
  }
});
