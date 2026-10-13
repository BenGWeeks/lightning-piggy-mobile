import { StyleSheet, Platform } from 'react-native';
import type { Palette } from './palettes';
export const createNfcWriteSheetStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    handleIndicator: {
      backgroundColor: colors.divider,
      width: 40,
    },
    content: {
      // No `flex: 1` — that overrides gorhom v5's content-driven
      // sizing and forces the sheet to fill the screen instead of
      // hugging its content. Project rule: no hardcoded sheet heights.
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingTop: 8,
      paddingBottom: 40,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
      marginBottom: 24,
    },
    stateContainer: {
      // Hugs its children so dynamic sheet sizing measures the true
      // content height. The flex:1 we had here pushed the sheet to
      // full-screen and forced the user to swipe up to see the
      // diagnostic message on error.
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
    },
    iconContainer: {
      width: 100,
      height: 100,
      borderRadius: 50,
      backgroundColor: colors.brandPinkLight,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
    },
    successIcon: {
      backgroundColor: colors.greenLight,
    },
    errorIcon: {
      // Theme-aware error tint — `redLight` is a tuned light/dark
      // pair in the palette so the dark-theme variant doesn't
      // produce eye-burn against the dark surface.
      backgroundColor: colors.redLight,
    },
    checkmark: {
      fontSize: 48,
      color: colors.green,
      fontWeight: '700',
    },
    errorBadge: {
      position: 'absolute',
      bottom: 0,
      right: 0,
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 1,
    },
    instruction: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
      textAlign: 'center',
      marginBottom: 8,
    },
    description: {
      fontSize: 14,
      color: colors.textSupplementary,
      textAlign: 'center',
      lineHeight: 20,
      paddingHorizontal: 16,
      marginBottom: 16,
    },
    npubPreview: {
      fontSize: 13,
      fontWeight: '500',
      color: colors.textSupplementary,
      backgroundColor: colors.background,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 8,
      overflow: 'hidden',
      marginBottom: 16,
    },
    waitingIndicator: {
      marginBottom: 8,
    },
    waitingText: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginBottom: 24,
    },
    cancelButton: {
      paddingHorizontal: 32,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: colors.divider,
    },
    cancelButtonText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.textSupplementary,
    },
    doneButton: {
      paddingHorizontal: 48,
      paddingVertical: 14,
      borderRadius: 10,
      backgroundColor: colors.brandPink,
    },
    doneButtonText: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.white,
    },
    errorButtons: {
      flexDirection: 'row',
      gap: 12,
    },
    retryButton: {
      paddingHorizontal: 32,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: colors.brandPink,
    },
    retryButtonText: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.white,
    },
    // ---- Post-write PIN card (success state, #567) -----------------------
    pinCard: {
      width: '100%',
      padding: 12,
      marginBottom: 16,
      borderRadius: 12,
      backgroundColor: colors.brandPinkLight,
      borderWidth: 1,
      borderColor: colors.brandPink,
      gap: 8,
    },
    pinHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    pinHeaderText: {
      fontSize: 11,
      fontWeight: '800',
      color: colors.brandPink,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    pinValueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    pinValueText: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
      letterSpacing: 2,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    pinCopyButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.brandPink,
      backgroundColor: colors.surface,
    },
    pinCopyButtonText: { fontSize: 12, fontWeight: '700', color: colors.brandPink },
  });
