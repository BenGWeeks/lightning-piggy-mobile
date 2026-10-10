import { StyleSheet } from 'react-native';

import type { Palette } from './palettes';

export const createNotificationPermissionRowStyles = (colors: Palette) =>
  StyleSheet.create({
    allowedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 16,
    },
    allowedText: {
      flex: 1,
      fontSize: 13,
      color: colors.white,
    },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.brandPink,
      backgroundColor: colors.surface,
      marginBottom: 16,
    },
    bannerText: {
      flex: 1,
    },
    bannerTitle: {
      fontSize: 15,
      color: colors.textHeader,
      fontWeight: '600',
    },
    bannerStatus: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginTop: 2,
    },
    bannerButton: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 18,
      backgroundColor: colors.brandPink,
    },
    bannerButtonText: {
      color: colors.white,
      fontSize: 13,
      fontWeight: '700',
    },
  });

export type NotificationPermissionRowStyles = ReturnType<
  typeof createNotificationPermissionRowStyles
>;
