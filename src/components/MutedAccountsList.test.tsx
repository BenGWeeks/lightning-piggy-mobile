import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import MutedAccountsList from './MutedAccountsList';
import { lightPalette as mockPalette } from '../styles/palettes';
import { shortNpub } from '../utils/shortNpub';
import mockEn from '../i18n/locales/en.json';

const PEER = 'b'.repeat(64);
const UNKNOWN = 'c'.repeat(64);
let mockMuted = new Set([PEER, UNKNOWN]);
const mockToggle = jest.fn().mockResolvedValue(undefined);
jest.mock('../hooks/useMutedSenders', () => ({
  useMutedSenders: () => ({ mutedSenders: mockMuted, toggle: mockToggle }),
}));
jest.mock('../contexts/NostrContext', () => ({
  useNostrContacts: () => ({
    contacts: [
      {
        pubkey: 'B'.repeat(64),
        profile: {
          displayName: 'Middle Piggy',
          name: 'Old name',
          picture: 'https://example.com/avatar.png',
        },
      },
    ],
  }),
}));
jest.mock('../contexts/GroupsContext', () => ({
  useGroups: () => ({ getGroup: () => undefined }),
}));
jest.mock('../contexts/ThemeContext', () => ({ useThemeColors: () => mockPalette }));
jest.mock('../contexts/LocaleContext', () => ({
  useTranslation: () => (key: string) =>
    (mockEn.notificationMute as Record<string, string>)[key.split('.')[1]],
}));
jest.mock('../components/BrandedToast', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));

beforeEach(() => {
  mockMuted = new Set([PEER, UNKNOWN]);
  jest.clearAllMocks();
});

it('renders a settings card with profile avatars, names, short npubs and Unmute buttons', () => {
  const ui = render(<MutedAccountsList />);
  expect(ui.getByTestId('muted-accounts-card-header')).toHaveStyle({
    backgroundColor: mockPalette.surface,
  });
  expect(ui.getByTestId(`muted-account-row-${PEER}`)).toHaveStyle({
    backgroundColor: mockPalette.surface,
    flexDirection: 'row',
  });
  expect(ui.getByText('Middle Piggy')).toBeTruthy();
  expect(ui.getByText(shortNpub(UNKNOWN))).toBeTruthy();
  const avatar = ui.getByTestId(`muted-account-avatar-${PEER}`);
  expect(avatar.props.source.uri).toBe('https://example.com/avatar.png');
  expect(avatar.props.cachePolicy).toBe('memory-disk');
  expect(ui.getAllByText('Unmute')).toHaveLength(2);
  fireEvent.press(ui.getByTestId(`muted-account-unmute-${PEER}`));
  expect(mockToggle).toHaveBeenCalledWith(PEER);
  fireEvent(avatar, 'error');
  expect(ui.getByTestId(`muted-account-avatar-fallback-${PEER}`)).toBeTruthy();
  expect(ui.getByTestId(`muted-account-avatar-fallback-${UNKNOWN}`)).toBeTruthy();
});

it('renders the empty state inside the settings card', () => {
  mockMuted = new Set();
  const ui = render(<MutedAccountsList />);
  expect(ui.getByText('No muted accounts')).toBeTruthy();
  expect(ui.getByTestId('muted-accounts-empty')).toHaveStyle({
    backgroundColor: mockPalette.surface,
  });
  expect(ui.queryAllByText('Unmute')).toHaveLength(0);
});
