import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createPublishedRelayListsSectionStyles = (colors: Palette) =>
  StyleSheet.create({
    list: {
      backgroundColor: 'rgba(255,255,255,0.1)',
      borderRadius: 10,
      paddingVertical: 4,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      paddingHorizontal: 12,
      gap: 8,
    },
    urlColumn: {
      flex: 1,
    },
    url: {
      color: colors.white,
      fontSize: 13,
    },
    urlWarning: {
      color: colors.white,
      fontSize: 10,
      opacity: 0.75,
      marginTop: 1,
    },
    empty: {
      color: colors.white,
      fontSize: 12,
      opacity: 0.7,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    pill: {
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.5)',
    },
    pillOn: {
      backgroundColor: colors.white,
      borderColor: colors.white,
    },
    pillText: {
      color: colors.white,
      fontSize: 11,
      fontWeight: '600',
    },
    pillTextOn: {
      color: colors.brandPink,
    },
    removeButton: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.15)',
    },
    addRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 12,
    },
    addInput: {
      flex: 1,
    },
    addButton: {
      backgroundColor: colors.surface,
      paddingHorizontal: 16,
      height: 52,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
    },
    addButtonText: {
      color: colors.brandPink,
      fontSize: 14,
      fontWeight: '700',
    },
    publishButton: {
      marginTop: 12,
      height: 48,
      borderRadius: 12,
      backgroundColor: colors.white,
      justifyContent: 'center',
      alignItems: 'center',
    },
    publishButtonDisabled: {
      opacity: 0.45,
    },
    publishButtonText: {
      color: colors.brandPink,
      fontSize: 15,
      fontWeight: '700',
    },
  });

export type PublishedRelayListsSectionStyles = ReturnType<
  typeof createPublishedRelayListsSectionStyles
>;
