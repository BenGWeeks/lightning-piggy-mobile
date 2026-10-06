import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createNotificationBellStyles = (colors: Palette) =>
  StyleSheet.create({
    button: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(255,255,255,0.25)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    badge: {
      position: 'absolute',
      top: -4,
      right: -4,
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      paddingHorizontal: 4,
      backgroundColor: colors.white,
      justifyContent: 'center',
      alignItems: 'center',
    },
    badgeText: {
      color: colors.brandPink,
      fontSize: 11,
      fontWeight: '700',
    },
  });
