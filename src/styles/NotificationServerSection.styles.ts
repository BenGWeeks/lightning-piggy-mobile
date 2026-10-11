import { StyleSheet } from 'react-native';

import type { Palette } from './palettes';

export const createNotificationServerSectionStyles = (colors: Palette) =>
  StyleSheet.create({
    toggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 10,
      paddingVertical: 4,
    },
    toggleText: {
      flexShrink: 1,
      color: colors.white,
      fontSize: 13,
      fontWeight: '600',
    },
    card: {
      marginTop: 8,
      padding: 14,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
      gap: 8,
    },
    text: {
      fontSize: 13,
      color: colors.textSupplementary,
    },
    serverInput: {
      borderWidth: 1,
      borderColor: colors.divider,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 13,
      color: colors.textHeader,
      backgroundColor: colors.background,
    },
    buttons: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    primaryButton: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 18,
      backgroundColor: colors.brandPink,
    },
    primaryButtonText: {
      color: colors.white,
      fontSize: 13,
      fontWeight: '700',
    },
    secondaryButton: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.brandPink,
    },
    secondaryButtonText: {
      color: colors.brandPink,
      fontSize: 13,
      fontWeight: '700',
    },
  });

export type NotificationServerSectionStyles = ReturnType<
  typeof createNotificationServerSectionStyles
>;
