import { StyleSheet } from 'react-native';

import type { Palette } from './palettes';

export const createMarmotPushSectionStyles = (colors: Palette) =>
  StyleSheet.create({
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      marginTop: 8,
    },
    statusText: {
      flex: 1,
      color: colors.white,
      fontSize: 13,
    },
    noticeText: {
      color: colors.white,
      fontSize: 13,
      marginTop: 8,
    },
    pillButton: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 18,
      backgroundColor: colors.white,
    },
    pillButtonText: {
      color: colors.brandPink,
      fontSize: 13,
      fontWeight: '700',
    },
  });

export type MarmotPushSectionStyles = ReturnType<typeof createMarmotPushSectionStyles>;
