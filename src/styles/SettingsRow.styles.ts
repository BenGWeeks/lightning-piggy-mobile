import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createSettingsRowStyles = (colors: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 0,
      backgroundColor: 'rgba(255,255,255,0.1)',
      borderRadius: 12,
      paddingVertical: 0,
      paddingHorizontal: 14,
      marginTop: 8,
      minHeight: 76,
    },
    main: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 14,
      minHeight: 76,
    },
    icon: { width: 24, alignItems: 'center' },
    text: { flex: 1, minWidth: 0 },
    title: { color: colors.white, fontSize: 15, fontWeight: '600' },
    subtitle: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 },
    info: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  });
