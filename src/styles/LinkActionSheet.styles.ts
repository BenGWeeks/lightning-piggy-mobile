import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createLinkActionSheetStyles = (colors: Palette) =>
  StyleSheet.create({
    background: { backgroundColor: colors.surface },
    handle: { backgroundColor: colors.textSupplementary },
    content: { padding: 24, gap: 16 },
    title: { fontSize: 22, fontWeight: '700', color: colors.textHeader },
    message: { fontSize: 17, color: colors.textHeader },
    button: { padding: 16, borderRadius: 16, backgroundColor: colors.brandPink },
    label: { fontSize: 17, fontWeight: '700', textAlign: 'center', color: colors.white },
  });
