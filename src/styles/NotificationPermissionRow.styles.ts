import { StyleSheet } from 'react-native';

import type { Palette } from './palettes';

export const createNotificationPermissionRowStyles = (colors: Palette) =>
  StyleSheet.create({
    permissionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
      marginTop: 12,
    },
    permissionText: {
      flex: 1,
    },
    permissionTitle: {
      fontSize: 15,
      color: colors.textHeader,
      fontWeight: '600',
    },
    permissionStatus: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginTop: 2,
    },
    permissionButton: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 18,
      backgroundColor: colors.brandPink,
    },
    permissionButtonText: {
      color: colors.white,
      fontSize: 13,
      fontWeight: '700',
    },
  });

export type NotificationPermissionRowStyles = ReturnType<
  typeof createNotificationPermissionRowStyles
>;
