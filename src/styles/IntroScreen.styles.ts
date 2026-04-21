import { StyleSheet, Dimensions } from 'react-native';
import { colors } from './theme';

const { height: screenHeight } = Dimensions.get('window');

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.brandPink,
    alignItems: 'center',
  },
  introImage: {
    width: '100%',
    height: screenHeight * 0.46,
  },
  logo: {
    width: 153,
    height: 62,
    marginTop: 24,
  },
  description: {
    color: colors.white,
    maxWidth: 301,
    marginTop: 37,
    fontSize: 16,
    fontWeight: '400',
    textAlign: 'center',
    lineHeight: 22,
  },
  bitcoinLogo: {
    width: 41,
    height: 41,
    marginTop: 37,
  },
});
