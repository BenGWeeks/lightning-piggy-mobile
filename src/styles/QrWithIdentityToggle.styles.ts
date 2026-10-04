import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createQrWithIdentityToggleStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      alignItems: 'center',
      marginHorizontal: 16,
      marginTop: 18,
      marginBottom: 12,
      paddingHorizontal: 16,
      paddingTop: 28,
      paddingBottom: 16,
      gap: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.brandPink,
    },
    // Toggle styling matches the original bottom-sheet QrSheet for
    // theme-consistent contrast: track uses `colors.background` (the
    // page bg, darker than `colors.surface` which is what the box
    // uses), active tab is white with brandPink text. Works in both
    // light and dark themes — the page bg and surface bg are the two
    // standard contrasting tones in the palette.
    toggleRow: {
      flexDirection: 'row',
      backgroundColor: colors.background,
      borderRadius: 10,
      padding: 3,
      marginTop: -46,
    },
    toggleTab: {
      paddingHorizontal: 20,
      paddingVertical: 8,
      borderRadius: 8,
    },
    toggleTabActive: {
      backgroundColor: colors.white,
    },
    toggleText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSupplementary,
    },
    toggleTextActive: {
      color: colors.brandPink,
    },
    qrContainer: {
      padding: 16,
      backgroundColor: colors.white,
      borderRadius: 16,
    },
    valueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.background,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 10,
      maxWidth: '90%',
    },
    valueText: {
      fontSize: 13,
      color: colors.textSupplementary,
      fontWeight: '500',
      flex: 1,
    },
    actionRow: {
      flexDirection: 'row',
      gap: 16,
      paddingTop: 4,
    },
    iconButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
    iconButtonDisabled: {
      opacity: 0.4,
    },
  });
