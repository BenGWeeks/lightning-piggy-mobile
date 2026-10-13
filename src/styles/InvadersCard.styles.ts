import { StyleSheet } from 'react-native';
import { CARD_HEIGHT } from './WalletCard.styles';

// Preserve the landscape artwork's 3:2 ratio at the full card height.
// The picker scales this same card, including its right-anchored artwork.
export const bgStyle = StyleSheet.create({
  full: {
    position: 'absolute',
    height: CARD_HEIGHT,
    width: CARD_HEIGHT * 1.5,
    right: 0,
    top: 0,
  },
});
