import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import ConversationMessageRow, { type ConversationMessageRowProps } from './ConversationMessageRow';
import { createConversationScreenStyles } from '../styles/ConversationScreen.styles';
import { lightPalette } from '../styles/palettes';
import i18n from '../i18n';
import type MessageBubble from './MessageBubble';
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

// The seller panel (wallet + relay hooks) is covered by SellerOrderPanel.test.
jest.mock('./SellerOrderPanel', () => () => null);
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
jest.mock('../contexts/WalletContext', () => ({
  useWallet: () => ({ currency: 'USD' }),
  useWalletLive: () => ({ btcPrice: null }),
}));
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

it.each([false, true])(
  'opens the appropriate order detail without rendering contact fields (fromMe=%s)',
  (fromMe) => {
    const ui = render(
      <ConversationMessageRow
        {...props}
        peerPubkey="peer"
        item={{
          kind: 'order',
          id: 'order-row',
          fromMe,
          createdAt: 100,
          order: {
            kind: 16,
            type: 'order',
            orderId: 'order-1',
            items: [{ ref: 'product', quantity: 1 }],
            message: '',
            address: 'PRIVATE ADDRESS',
            email: 'PRIVATE EMAIL',
            phone: 'PRIVATE PHONE',
            contact: 'PRIVATE CONTACT',
          },
        }}
      />,
    );
    for (const value of ['PRIVATE ADDRESS', 'PRIVATE EMAIL', 'PRIVATE PHONE', 'PRIVATE CONTACT'])
      expect(ui.queryByText(value)).toBeNull();
    fireEvent.press(ui.getByTestId('conversation-order-view-order-row'));
    expect(mockNavigate).toHaveBeenLastCalledWith('Main', {
      screen: 'MainTabs',
      params: {
        screen: 'Explore',
        params: fromMe
          ? { screen: 'MarketMyOrders', params: { orderId: 'order-1', sellerPubkey: 'peer' } }
          : { screen: 'MarketShopOrders', params: { orderId: 'order-1', buyerPubkey: 'peer' } },
      },
    });
  },
);
