import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';
import { CARD_WIDTH, CARD_MARGIN, CARD_HEIGHT } from './WalletCard.styles';

export const createAddWalletCardStyles = (colors: Palette) =>
  StyleSheet.create({
    cardContainer: {
      width: CARD_WIDTH,
      marginHorizontal: CARD_MARGIN,
    },
    card: {
      height: CARD_HEIGHT,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: colors.divider,
      borderStyle: 'dashed',
      backgroundColor: 'rgba(255,255,255,0.1)',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 8,
    },
    plusIcon: {
      fontSize: 48,
      fontWeight: '300',
      color: colors.white,
      opacity: 0.7,
    },
    label: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.white,
      opacity: 0.7,
    },
  });
