import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createNostrScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    // Experimental section (#1057) — native crypto tester toggle. Matches the
    // white-on-gradient look of the rest of this screen.
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

export type NostrScreenStyles = ReturnType<typeof createNostrScreenStyles>;
