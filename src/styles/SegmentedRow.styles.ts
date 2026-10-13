import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';
export const createSegmentedRowStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      marginTop: 8,
      borderRadius: 12,
      backgroundColor: 'rgba(255,255,255,0.1)',
      padding: 14,
    },
    grouped: { marginTop: 0, borderRadius: 0, backgroundColor: 'transparent' },
    heading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
    title: { flex: 1, color: colors.white, fontSize: 15, fontWeight: '600' },
    segments: { flexDirection: 'row', gap: 4 },
    segment: {
      flex: 1,
      minHeight: 48,
      paddingHorizontal: 8,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 8,
    },
    selected: { backgroundColor: colors.accentSecondary },
    label: { color: colors.white, fontSize: 14, textAlign: 'center' },
    subtitle: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 8 },
    disabled: { opacity: 0.5 },
    measure: { position: 'absolute', opacity: 0, pointerEvents: 'none' },
  });
