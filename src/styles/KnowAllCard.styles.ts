import { StyleSheet } from 'react-native';
import { CARD_HEIGHT } from './WalletCard.styles';

// The picker scales the full card, so this 3:2 box fits both sizes. Top and
// bottom insets cover the full border box, including the card's padding.
export const knowAllCardStyles = StyleSheet.create({
  background: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: CARD_HEIGHT * 1.5,
    right: 0,
  },
});
