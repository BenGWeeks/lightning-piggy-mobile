import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createPublishedRelayListsSectionStyles = (colors: Palette) =>
  StyleSheet.create({
    list: {
      backgroundColor: 'rgba(255,255,255,0.1)',
      borderRadius: 10,
      paddingVertical: 4,
    },
    rowContainer: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    openRow: {
      flex: 1,
      minWidth: 0,
    },
    rowRemoveButton: {
      marginRight: 12,
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
    accessTag: {
      color: colors.white,
      fontSize: 11,
      backgroundColor: 'rgba(255,255,255,0.15)',
      borderRadius: 6,
      paddingHorizontal: 6,
      paddingVertical: 4,
    },
    empty: {
      color: colors.white,
      fontSize: 12,
      opacity: 0.7,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    removeButton: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
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
