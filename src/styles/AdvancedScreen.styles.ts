import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createAdvancedScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    sectionGap: {
      marginTop: 28,
    },
    // A row that opens a sub-page (Nostr network, Bitcoin network).
    navRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: 'rgba(255,255,255,0.1)',
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 14,
      marginTop: 8,
    },
    navIcon: {
      width: 24,
      alignItems: 'center',
    },
    navText: {
      flex: 1,
    },
    // Switch rows (Experimental #1057, Developer options) and the nav rows
    // above share this white-on-gradient look.
    experimentalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: 'rgba(255,255,255,0.1)',
      borderRadius: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginTop: 12,
      gap: 12,
    },
    experimentalRowDisabled: {
      opacity: 0.55,
    },
    experimentalTextBlock: {
      flex: 1,
    },
    experimentalLabel: {
      color: colors.white,
      fontSize: 15,
      fontWeight: '600',
    },
    experimentalSubtitle: {
      color: 'rgba(255,255,255,0.6)',
      fontSize: 12,
      marginTop: 2,
    },
    experimentalActive: {
      color: 'rgba(255,255,255,0.7)',
      fontSize: 12,
      fontWeight: '600',
      marginTop: 8,
    },
  });

export type AdvancedScreenStyles = ReturnType<typeof createAdvancedScreenStyles>;
