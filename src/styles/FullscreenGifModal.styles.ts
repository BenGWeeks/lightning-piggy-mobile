import { StyleSheet } from 'react-native';

// Theme-independent: a near-black backdrop behind the GIF in both themes.
export const fullscreenGifModalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
