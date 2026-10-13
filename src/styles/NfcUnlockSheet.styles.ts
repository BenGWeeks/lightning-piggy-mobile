import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';
export const createNfcUnlockSheetStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    handleIndicator: { backgroundColor: colors.divider, width: 40 },
    content: {
      // No flex:1 — let the sheet hug its content (gorhom v5 dynamic
      // sizing). Project rule: no hardcoded sheet heights.
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingTop: 8,
      paddingBottom: 40,
    },
    title: { fontSize: 18, fontWeight: '700', color: colors.textHeader, marginBottom: 24 },
    stateContainer: { alignItems: 'center', justifyContent: 'center', width: '100%' },
    iconContainer: {
      width: 100,
      height: 100,
      borderRadius: 50,
      backgroundColor: colors.brandPinkLight,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
    },
    successIcon: { backgroundColor: colors.greenLight },
    errorIcon: { backgroundColor: colors.redLight },
    checkmark: { fontSize: 48, color: colors.green, fontWeight: '700' },
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
    waitingIndicator: { marginBottom: 8 },
    waitingText: { fontSize: 13, color: colors.textSupplementary, marginBottom: 24 },
    cancelButton: {
      paddingHorizontal: 32,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: colors.divider,
    },
    cancelButtonText: { fontSize: 15, fontWeight: '600', color: colors.textSupplementary },
    doneButton: {
      paddingHorizontal: 48,
      paddingVertical: 14,
      borderRadius: 10,
      backgroundColor: colors.brandPink,
    },
    doneButtonText: { fontSize: 15, fontWeight: '700', color: colors.white },
    errorButtons: { flexDirection: 'row', gap: 12 },
    retryButton: {
      paddingHorizontal: 32,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: colors.brandPink,
    },
    retryButtonText: { fontSize: 15, fontWeight: '700', color: colors.white },
  });
