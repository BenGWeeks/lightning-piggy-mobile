import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Image } from 'expo-image';
import GroupMessageRow from './GroupMessageRow';

jest.mock('../contexts/ThemeContext', () => ({
  useThemeColors: () => jest.requireActual('../styles/palettes').lightPalette,
}));
jest.mock('./MessageBubble', () => {
  const { Text } = jest.requireActual('react-native');
  return { __esModule: true, default: ({ id }: { id: string }) => <Text>{id}</Text> };
});
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));

const props = {
  id: 'msg1',
  fromMe: false,
  createdAt: 1,
  content: { kind: 'text' as const, text: 'Hello' },
  autoLoadMedia: false,
  testIdPrefix: 'group-conversation',
  senderPubkey: 'a'.repeat(64),
  senderName: 'Curious Fox',
  senderPicture: null,
  showSender: true,
  onOpenSender: jest.fn(),
  onPayInvoice: jest.fn(),
  onPayLightningAddress: jest.fn(),
  onOpenContact: jest.fn(),
  onOpenLocation: jest.fn(),
};

beforeEach(() => jest.clearAllMocks());

test('avatar initials and name both open the sender profile', () => {
  const ui = render(<GroupMessageRow {...props} />);
  expect(ui.getByText('CF')).toBeTruthy();
  fireEvent.press(ui.getByTestId('group-msg-avatar-msg1'));
  fireEvent.press(ui.getByTestId('group-msg-sender-msg1'));
  expect(props.onOpenSender).toHaveBeenNthCalledWith(1, props.senderPubkey);
  expect(props.onOpenSender).toHaveBeenNthCalledWith(2, props.senderPubkey);
});

test('uses cached expo-image and falls back to initials on an image error', () => {
  const ui = render(<GroupMessageRow {...props} senderPicture="https://example.com/photo.png" />);
  const image = ui.UNSAFE_getByType(Image);
  expect(image.props.cachePolicy).toBe('memory-disk');
  expect(image.props.autoplay).toBe(false);
  fireEvent(image, 'error');
  expect(ui.getByText('CF')).toBeTruthy();
  expect(ui.UNSAFE_queryByType(Image)).toBeNull();
});

test.each([{ showSender: false }, { fromMe: true }])(
  'omits sender controls for repeated or outgoing messages: %o',
  (overrides) => {
    const ui = render(<GroupMessageRow {...props} {...overrides} />);
    expect(ui.queryByTestId('group-msg-avatar-msg1')).toBeNull();
    expect(ui.queryByTestId('group-msg-sender-msg1')).toBeNull();
    expect(ui.getByText('msg1')).toBeTruthy();
  },
);
