import { StyleSheet, Dimensions } from 'react-native';
import type { Palette } from './palettes';

const { height: screenHeight } = Dimensions.get('window');

export const createIntroScreenStyles = (colors: Palette) =>
  StyleSheet.create({
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
    button: {
      backgroundColor: colors.white,
      marginTop: 37,
      height: 52,
      marginHorizontal: 33,
      alignSelf: 'stretch',
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.12,
      shadowRadius: 5,
      elevation: 4,
    },
    buttonText: {
      color: colors.brandPink,
      fontSize: 16,
      fontWeight: '700',
    },
    bitcoinLogo: {
      width: 41,
      height: 41,
      marginTop: 37,
    },
  });
