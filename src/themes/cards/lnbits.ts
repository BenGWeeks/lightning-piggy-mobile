import { StyleSheet } from 'react-native';

export const bgStyle = StyleSheet.create({
  full: {
    position: 'absolute',
    width: 120,
    height: 120,
    right: -25,
    bottom: 12,
    opacity: 0.75,
    transform: [{ rotate: '-90deg' }],
  },
});
