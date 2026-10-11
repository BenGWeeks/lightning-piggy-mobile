import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

// Styles mirror PaymentProgressOverlay so send/receive confirmations and
// system alerts feel like siblings from the same family. Factory shape
// (rather than module-level `StyleSheet.create`) so the dialog reads
// the live theme palette via `useThemeColors()` — light/dark switch
// applies without restart.
export const createBrandedAlertStyles = (colors: Palette) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: 'rgba(21, 23, 26, 0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 28,
      paddingVertical: 32,
      paddingHorizontal: 28,
      minWidth: 260,
      maxWidth: 340,
      alignItems: 'center',
      gap: 14,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.2,
      shadowRadius: 24,
      elevation: 12,
    },
    iconSlot: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.textHeader,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 14,
      color: colors.textSupplementary,
      textAlign: 'center',
      lineHeight: 20,
    },
    buttonRow: {
      flexDirection: 'row',
      alignSelf: 'stretch',
      gap: 10,
      marginTop: 6,
    },
    buttonColumn: {
      flexDirection: 'column-reverse',
    },
    button: {
      paddingVertical: 12,
      // 24px horizontal padding clipped 6+ char labels ("Cancel" / "Sign Out")
      // when two buttons sat side-by-side inside the card's 28px padding.
      // 12px is enough to keep the touch target tappable without crowding text.
      paddingHorizontal: 12,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Row mode (≤2 buttons) — flex:1 distributes width evenly. Column
    // mode (3+) instead hugs content height so stacked buttons don't
    // each grab a third of the screen. See the inline note above.
    buttonInRow: { flex: 1 },
    buttonStacked: { alignSelf: 'stretch' },
    primaryButton: {
      backgroundColor: colors.brandPink,
    },
    destructiveButton: {
      backgroundColor: colors.red,
    },
    cancelButton: {
      backgroundColor: colors.background,
    },
    buttonPressed: {
      opacity: 0.75,
    },
    buttonText: {
      fontSize: 16,
      fontWeight: '700',
      letterSpacing: 0.3,
    },
    actionButtonText: {
      color: colors.white,
    },
    cancelButtonText: {
      color: colors.textBody,
    },
  });
