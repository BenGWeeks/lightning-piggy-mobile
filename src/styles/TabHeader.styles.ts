import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createTabHeaderStyles = (colors: Palette) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 20,
      paddingBottom: 16,
    },
    badge: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(255,255,255,0.9)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    title: {
      color: colors.white,
      // Slightly lighter than the previous per-screen 28/700 because Home's
      // "Hello, <name>!" greeting reads better at a softer weight and the
      // section titles (Messages / Friends / Explore) still look substantial.
      fontSize: 24,
      fontWeight: '600',
      flexShrink: 1,
    },
    spacer: {
      flex: 1,
    },
  });
