import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createNostrScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    relayList: {
      backgroundColor: 'rgba(255,255,255,0.1)',
      borderRadius: 10,
      paddingVertical: 4,
    },
    relayRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      paddingHorizontal: 12,
      gap: 10,
    },
    statusDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      borderWidth: 1,
      borderColor: colors.white,
    },
    relayMain: {
      flex: 1,
    },
    relayUrl: {
      color: colors.white,
      fontSize: 13,
    },
    relaySource: {
      color: colors.white,
      fontSize: 10,
      opacity: 0.6,
      marginTop: 1,
    },
    relayMode: {
      color: colors.white,
      fontSize: 11,
      opacity: 0.7,
      fontWeight: '500',
    },
    removeButton: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.15)',
    },
    addRelayRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 12,
    },
    addRelayInput: {
      flex: 1,
    },
    addRelayButton: {
      backgroundColor: colors.surface,
      paddingHorizontal: 16,
      height: 52,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
    },
    addRelayButtonText: {
      color: colors.brandPink,
      fontSize: 14,
      fontWeight: '700',
    },
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
