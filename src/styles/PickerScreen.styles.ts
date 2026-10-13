import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';
export const createPickerScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    card: { flex: 1, backgroundColor: colors.surface, borderRadius: 12, overflow: 'hidden' },
    search: {
      minHeight: 48,
      padding: 14,
      color: colors.textBody,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
    row: { minHeight: 56, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
    text: { flex: 1 },
    label: { fontSize: 16, color: colors.textBody },
    subtitle: { fontSize: 13, color: colors.textSupplementary },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider },
    disabled: { opacity: 0.5 },
    empty: { padding: 16, color: colors.textSupplementary },
  });
