import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';
export const createSettingsInfoSheetStyles = (colors: Palette) =>
  StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
    backdrop: { flex: 1 },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 24,
      maxHeight: '75%',
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
    title: { flex: 1, color: colors.textHeader, fontSize: 20, fontWeight: '700' },
    close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    body: { color: colors.textBody, fontSize: 15, lineHeight: 23, marginBottom: 12 },
  });
