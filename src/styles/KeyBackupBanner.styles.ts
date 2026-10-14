import { StyleSheet } from 'react-native';

import type { Palette } from './palettes';

export const createKeyBackupBannerStyles = (colors: Palette) =>
  StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginHorizontal: 16,
      marginTop: 16,
      marginBottom: 4,
      paddingVertical: 12,
      paddingLeft: 14,
      paddingRight: 8,
      borderRadius: 16,
      backgroundColor: colors.brandPinkLight,
    },
    iconCircle: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.brandPink,
      justifyContent: 'center',
      alignItems: 'center',
    },
    text: {
      flex: 1,
      gap: 2,
    },
    title: {
      color: colors.textHeader,
      fontSize: 15,
      fontWeight: '700',
    },
    body: {
      color: colors.textBody,
      fontSize: 13,
      lineHeight: 18,
    },
    dismiss: {
      padding: 6,
    },
  });
