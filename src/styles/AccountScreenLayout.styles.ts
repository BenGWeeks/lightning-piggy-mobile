import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createAccountScreenLayoutStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.brandPink,
    },
    flex: {
      flex: 1,
    },
    bgImage: {
      position: 'absolute',
      width: 420,
      height: 420,
      right: -60,
      top: -20,
      opacity: 0.15,
    },
    content: {
      paddingHorizontal: 20,
      paddingBottom: 40,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 24,
    },
    backButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(255,255,255,0.9)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    title: {
      flexShrink: 1,
      color: colors.white,
      fontSize: 28,
      fontWeight: '700',
    },
  });
