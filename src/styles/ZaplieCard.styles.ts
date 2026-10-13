import { StyleSheet } from 'react-native';
import { CARD_HEIGHT } from './WalletCard.styles';

// Preserve the approved landscape artwork's 3:2 proportions at full card
// height. MiniWalletCard scales this same full-size composition.
export const bgStyle = StyleSheet.create({
  full: {
    position: 'absolute',
    height: CARD_HEIGHT,
    width: CARD_HEIGHT * 1.5,
    right: 0,
    top: 0,
  },
});
