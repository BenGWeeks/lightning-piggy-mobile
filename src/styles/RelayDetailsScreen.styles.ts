import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createRelayDetailsScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    url: { color: colors.white, fontSize: 15, marginBottom: 16 },
    card: {
      backgroundColor: 'rgba(255,255,255,0.12)',
      padding: 14,
      borderRadius: 12,
      marginBottom: 16,
      gap: 10,
    },
    heading: { color: colors.white, fontSize: 19, fontWeight: '700', marginBottom: 4 },
    label: { color: colors.white, fontSize: 12, opacity: 0.75 },
    value: { color: colors.white, fontSize: 14, lineHeight: 20 },
    about: { flexDirection: 'row', gap: 12, alignItems: 'center' },
    aboutText: { flex: 1 },
    iconBox: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
    icon: { width: 48, height: 48, borderRadius: 12, position: 'absolute' },
    toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    remove: { backgroundColor: colors.white, padding: 14, borderRadius: 12, alignItems: 'center' },
    disabled: { opacity: 0.45 },
    removeText: { color: colors.brandPink, fontWeight: '700', fontSize: 15 },
  });
