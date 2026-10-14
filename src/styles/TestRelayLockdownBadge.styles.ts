import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';
export const createTestRelayLockdownBadgeStyles = (colors: Palette) =>
  StyleSheet.create({
    badge: {
      color: colors.white,
      backgroundColor: colors.brandPink,
      borderRadius: 10,
      padding: 12,
      marginBottom: 16,
    },
  });
