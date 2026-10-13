import { Dimensions, StyleSheet } from 'react-native';
import { CARD_HEIGHT } from './WalletCard.styles';

const SCREEN_WIDTH = Dimensions.get('window').width;
export const CAROUSEL_CARD_WIDTH = SCREEN_WIDTH * 0.86;
export const CAROUSEL_INTERVAL = CAROUSEL_CARD_WIDTH + 8;
export const CHIP_INTERVAL = 112;

// The end gutters centre the first and last cards as well as interior cards.
export const walletCarouselStyles = StyleSheet.create({
  container: { paddingTop: 8 },
  listContent: { paddingHorizontal: (SCREEN_WIDTH - CAROUSEL_INTERVAL) / 2 },
  cardContainer: { width: CAROUSEL_CARD_WIDTH, marginHorizontal: 4 },
  page: { width: CAROUSEL_INTERVAL, height: CARD_HEIGHT },
  stripContent: { paddingHorizontal: 16, paddingVertical: 12 },
  chipSlot: { width: CHIP_INTERVAL, height: 56, justifyContent: 'center', alignItems: 'center' },
  chip: {
    width: 100,
    height: 48,
    borderRadius: 10,
    overflow: 'hidden',
    opacity: 0.7,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  chipTouch: { flex: 1 },
  chipGradient: { flex: 1, paddingHorizontal: 8, justifyContent: 'center', gap: 2 },
  chipName: { fontSize: 12, fontWeight: '600' },
  chipBalance: { fontSize: 10 },
  addChip: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  plus: { fontSize: 24, color: '#FFFFFF' },
});
