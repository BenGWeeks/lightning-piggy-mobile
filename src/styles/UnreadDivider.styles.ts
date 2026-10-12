import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createUnreadDividerStyles = (colors: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    line: {
      flex: 1,
      height: StyleSheet.hairlineWidth * 2,
      backgroundColor: colors.brandPink,
      opacity: 0.5,
    },
    pill: {
      backgroundColor: colors.brandPinkLight,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 4,
    },
    text: {
      color: colors.brandPink,
      fontSize: 12,
      fontWeight: '700',
    },
  });
