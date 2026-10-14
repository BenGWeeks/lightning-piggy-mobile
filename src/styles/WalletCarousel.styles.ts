import { Dimensions, StyleSheet } from 'react-native';
import { CARD_HEIGHT } from './WalletCard.styles';

const SCREEN_WIDTH = Dimensions.get('window').width;
export const CAROUSEL_CARD_WIDTH = SCREEN_WIDTH * 0.86;
export const CAROUSEL_INTERVAL = CAROUSEL_CARD_WIDTH + 8;

// Theme-independent (the carousel sits on the brand gradient in both themes).
// The end gutters centre the first and last cards as well as interior cards.
export const walletCarouselStyles = StyleSheet.create({
  container: { paddingTop: 8 },
  listContent: { paddingHorizontal: (SCREEN_WIDTH - CAROUSEL_INTERVAL) / 2 },
  cardContainer: { width: CAROUSEL_CARD_WIDTH, marginHorizontal: 4 },
  page: { width: CAROUSEL_INTERVAL, height: CARD_HEIGHT },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingTop: 12,
    paddingBottom: 4,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});

export const DOT_ACTIVE_COLOR = '#FFFFFF';
export const DOT_INACTIVE_COLOR = 'rgba(255, 255, 255, 0.4)';
