import { StyleSheet } from 'react-native';

import type { Palette } from './palettes';

export const createSettingsSectionStyles = (colors: Palette) =>
  StyleSheet.create({
    // The header owns the gap to the first section below it, so a screen
    // never needs its own top margin on the heading that follows.
    container: {
      marginBottom: 20,
    },
    card: { borderRadius: 12, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.1)' },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: 'rgba(255,255,255,0.2)',
      marginHorizontal: 14,
    },
    header: {
      color: colors.white,
      fontSize: 13,
      fontWeight: '800',
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    labelRow: { flexDirection: 'row', alignItems: 'center' },
    info: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    gap: {
      marginTop: 36,
    },
  });
