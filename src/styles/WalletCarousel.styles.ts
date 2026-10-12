import { StyleSheet } from 'react-native';

// Theme-independent (the carousel sits on the brand gradient in both themes),
// so a static sheet rather than a `create…Styles(colors)` factory.
export const walletCarouselStyles = StyleSheet.create({
  container: {
    paddingTop: 8,
  },
  listContent: {},
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingTop: 12,
    paddingBottom: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    backgroundColor: '#FFFFFF',
  },
  dotInactive: {
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
});
