import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MessageBubble from './MessageBubble';
import { parseFileAttachment } from '../utils/fileAttachment';
import type { BubbleContent } from '../utils/messageContent';

jest.mock('../contexts/ThemeContext', () => ({
  useThemeColors: () => jest.requireActual('../styles/palettes').lightPalette,
}));
jest.mock('../contexts/LocaleContext', () => ({
  useLocale: () => ({ t: (key: string) => key, formatLocale: 'en' }),
  useTranslation: () => (key: string) => key,
}));
jest.mock('../services/boltzService', () => ({ isBitcoinAddress: () => false }));
jest.mock('./LinkifiedText', () => ({ LinkifiedText: () => null }));
jest.mock('./LibreMiniMap', () => () => null);
jest.mock('./MessageLinkPreview', () => () => null);
jest.mock('./MessageInvoiceActions', () => () => null);
jest.mock('expo-audio', () => ({
  useAudioPlayer: () => ({ play: jest.fn(), pause: jest.fn() }),
  useAudioPlayerStatus: () => ({ playing: false, duration: 10, currentTime: 0 }),
  setAudioModeAsync: jest.fn(),
}));
jest.mock('../services/decryptedMediaCache', () => ({ resolveDecryptedMedia: jest.fn() }));
jest.mock('./DecryptedImage', () => () => null);

const props = {
  id: 'msg',
  fromMe: true,
  createdAt: 1,
  autoLoadMedia: true,
  testIdPrefix: 'conversation',
  onPayInvoice: jest.fn(),
  onPayLightningAddress: jest.fn(),
  onOpenContact: jest.fn(),
  onOpenLocation: jest.fn(),
};
const variants: [string, BubbleContent][] = [
  ['text', { kind: 'text', text: 'Hello' }],
  [
    'invoice',
    { kind: 'text', text: 'lnbc10n1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' },
  ],
  ['secret card', { kind: 'text', text: 'secretthreewords' }],
  ['voice note', { kind: 'text', text: 'https://example.com/voice.m4a' }],
  ['image', { kind: 'text', text: 'https://example.com/photo.png' }],
  ['lightning address', { kind: 'text', text: 'lightning:sender@example.com' }],
  [
    'live location',
    {
      kind: 'liveLocationMarker',
      marker: {
        phase: 'start',
        sessionId: 'session',
        durationMs: 60000,
        startedAt: 1,
        location: { lat: 1, lon: 2, accuracyMeters: null },
      },
    },
  ],
  ['gif', { kind: 'gif', url: 'https://example.com/image.gif' }],
  [
    'poll',
    {
      kind: 'poll',
      poll: {
        question: 'Pick',
        options: [{ id: '1', label: 'One' }],
        pollType: 'singlechoice',
      },
    },
  ],
  ['location', { kind: 'location', location: { lat: 1, lon: 2, accuracyMeters: null } }],
];

test.each(variants)('outgoing %s renders the default diagonal gradient', (_label, content) => {
  const ui = render(<MessageBubble {...props} content={content} />);
  const gradient = ui.UNSAFE_getByType(LinearGradient);
  expect(gradient.props.colors).toEqual(['#EC008C', '#8B5CF6']);
  expect(gradient.props.start).toEqual({ x: 0, y: 0 });
  expect(gradient.props.end).toEqual({ x: 1, y: 1 });
});

test('received text keeps its plain surface; reaction pills still toggle', () => {
  const onToggleReaction = jest.fn();
  const ui = render(
    <MessageBubble
      {...props}
      fromMe={false}
      content={{ kind: 'text', text: 'Hi' }}
      reactions={{ byEmoji: { '❤': ['sender'] }, myReactions: {} }}
      onToggleReaction={onToggleReaction}
    />,
  );
  expect(ui.UNSAFE_queryByType(LinearGradient)).toBeNull();
  fireEvent.press(ui.getByTestId('conversation-reaction-msg-❤'));
  expect(onToggleReaction).toHaveBeenCalledWith('❤', null);
});

test.each([true, false])('file replies preserve their header and actions (fromMe=%s)', (fromMe) => {
  const onLongPress = jest.fn();
  const onToggleReaction = jest.fn();
  const ui = render(
    <MessageBubble
      {...props}
      fromMe={fromMe}
      senderName={fromMe ? undefined : 'Curious Fox'}
      content={{
        kind: 'file',
        file: parseFileAttachment(
          '[FILE]' +
            JSON.stringify({
              url: '',
              name: 'Invoice.pdf',
              mime: 'application/pdf',
              encrypted: true,
            }),
        )!,
      }}
      quote={{ text: 'Please send the invoice', fromMe: false, authorName: 'Parent author' }}
      onLongPress={onLongPress}
      reactions={{ byEmoji: { '❤': ['sender'] }, myReactions: {} }}
      onToggleReaction={onToggleReaction}
    />,
  );
  expect(ui.getByTestId('conversation-quote-msg')).toBeTruthy();
  expect(ui.getByText('Please send the invoice')).toBeTruthy();
  expect(ui.getByText('Parent author')).toBeTruthy();
  if (!fromMe) expect(ui.getByText('Curious Fox')).toBeTruthy();
  fireEvent(ui.getByTestId('chat-file-bubble-msg'), 'longPress');
  expect(onLongPress).toHaveBeenCalledTimes(1);
  fireEvent.press(ui.getByTestId('conversation-reaction-msg-❤'));
  expect(onToggleReaction).toHaveBeenCalledWith('❤', null);
});
