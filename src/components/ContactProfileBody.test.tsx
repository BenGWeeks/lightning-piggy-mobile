import React from 'react';
import { render } from '@testing-library/react-native';
import ContactProfileBody from './ContactProfileBody';

jest.mock('../contexts/ThemeContext', () => ({ useThemeColors: () => ({}) }));
jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (key: string) => key }));
jest.mock('../services/nostrService', () => ({ npubEncode: () => 'npub1test' }));
jest.mock('./MuteNotificationsButton', () => () => null);
jest.mock('./FullscreenImageModal', () => () => null);

it.each(['alice@example.com', 'al\u202eice@example.com'])(
  'shows a claimed handle as unverified',
  (nip05) => {
    const view = render(
      <ContactProfileBody
        contact={{
          pubkey: null,
          name: 'Alice',
          picture: null,
          lightningAddress: null,
          source: 'nostr',
          nip05,
        }}
      />,
    );
    expect(view.getByText('alice@example.com')).toBeTruthy();
    expect(view.getByTestId('contact-nip05-unverified')).toHaveTextContent(
      'profileSafety.unverified',
    );
    expect(view.getByText('Alice')).toBeTruthy();
  },
);
it('does not display an invalid handle or malformed cached text', () => {
  const view = render(
    <ContactProfileBody
      contact={{
        pubkey: null,
        name: {} as string,
        picture: null,
        lightningAddress: null,
        source: 'nostr',
        nip05: {} as string,
        about: [] as unknown as string,
      }}
    />,
  );
  expect(view.queryByText(/profileSafety.unverified/)).toBeNull();
  expect(view.queryByTestId('profile-error-fallback')).toBeNull();
});
it('keeps the unverified label visible for a handle long enough to truncate', () => {
  const view = render(
    <ContactProfileBody
      contact={{
        pubkey: null,
        name: 'Alice',
        picture: null,
        lightningAddress: null,
        source: 'nostr',
        nip05: `${'a'.repeat(300)}@example.com`,
      }}
    />,
  );
  // Separate elements: truncating the handle (numberOfLines=1) can't swallow the label.
  const badge = view.getByTestId('contact-nip05-unverified');
  expect(badge).toHaveTextContent('profileSafety.unverified');
  expect(view.getByText(/^a{300}@example\.com$/)).not.toBe(badge);
});
