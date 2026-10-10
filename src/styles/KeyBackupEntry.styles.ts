import { StyleSheet } from 'react-native';

import type { Palette } from './palettes';

// Mirrors the section header + row look of SecurityScreen so the entry
// sits naturally among its sections.
export const createKeyBackupEntryStyles = (colors: Palette) =>
  StyleSheet.create({
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 6,
    },
    headerLabel: {
      flexShrink: 1,
      color: colors.white,
      fontSize: 18,
      fontWeight: '700',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
      marginTop: 8,
      marginBottom: 24,
    },
    rowText: {
      flex: 1,
      marginRight: 8,
    },
    rowLabel: {
      fontSize: 15,
      color: colors.textHeader,
      fontWeight: '600',
    },
    rowSublabel: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginTop: 2,
    },
  });
