import React from 'react';
import { render } from '@testing-library/react-native';
import ConversationMessageRow, { type ConversationMessageRowProps } from './ConversationMessageRow';
import { createConversationScreenStyles } from '../styles/ConversationScreen.styles';
import { lightPalette } from '../styles/palettes';
import i18n from '../i18n';
import type MessageBubble from './MessageBubble';

jest.mock('../contexts/ThemeContext', () => ({
  useThemeColors: () => jest.requireActual('../styles/palettes').lightPalette,
}));
jest.mock('../contexts/LocaleContext', () => ({
  useLocale: () => ({ t: jest.requireActual('../i18n').t, formatLocale: 'en' }),
}));
jest.mock('./MessageBubble', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: ({ senderName }: React.ComponentProps<typeof MessageBubble>) => (
      <Text>{senderName ?? 'Unknown sender'}</Text>
    ),
  };
});
jest.mock('./OrderPaymentActions', () => () => null);
jest.mock('./NwcShareCard', () => () => null);
jest.mock('./MarmotInviteFailedNotice', () => () => null);
jest.mock('./DeviceNoticeLine', () => () => null);

const props: Omit<ConversationMessageRowProps, 'item'> = {
  styles: createConversationScreenStyles(lightPalette),
  colors: lightPalette,
  sharedProfiles: undefined,
  isInvoicePaid: undefined,
  onPayInvoice: jest.fn(),
  onOpenContact: jest.fn(),
  onOpenLocation: jest.fn(),
  onOpenGifFullscreen: undefined,
  onToggleSecretMode: undefined,
  pollAggregates: undefined,
  onVotePoll: undefined,
  onShowTxDetail: jest.fn(),
  liveLocationLatest: undefined,
  liveLocationStatus: undefined,
  liveLocationRemainingMs: undefined,
  onStopLiveLocation: undefined,
  myLat: undefined,
  myLon: undefined,
  myAccuracyMetres: undefined,
  myAvatarUri: undefined,
  peerAvatarUri: undefined,
  onOpenMap: undefined,
  onShowInfo: undefined,
  onLongPress: undefined,
  reactions: undefined,
  onToggleReaction: undefined,
  onAddNwc: jest.fn(),
  peerName: 'Curious Fox',
  peerMediaTrusted: false,
};

test.each([
  [true, 'en', 'You'],
  [true, 'es', 'Tú'],
  [false, 'en', 'Curious Fox'],
])('unsupported sender follows fromMe=%s in %s', (fromMe, locale, expected) => {
  i18n.locale = locale;
  try {
    const ui = render(
      <ConversationMessageRow
        {...props}
        item={{ kind: 'unsupported', id: 'other-device', fromMe, rawKind: 1234, createdAt: 1 }}
      />,
    );
    expect(ui.getByText(expected)).toBeTruthy();
  } finally {
    i18n.locale = 'en';
  }
});
