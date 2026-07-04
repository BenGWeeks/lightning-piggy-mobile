import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/**
 * Presentation for the Transfer sheet's in-flight progress view
 * (issue #62) — the step-by-step checklist + Retry/Close buttons that
 * replace the From/To/Amount form while a transfer executes. Extracted
 * out of TransferSheet.styles.ts alongside the TransferProgress
 * component so the sheet stays focused on the form/orchestration.
 */
export const createTransferProgressStyles = (colors: Palette) =>
  StyleSheet.create({
    progressView: {
      alignItems: 'center',
      gap: 16,
      paddingVertical: 24,
    },
    progressSummary: {
      fontSize: 28,
      fontWeight: '700',
      color: colors.brandPink,
    },
    progressRoute: {
      fontSize: 16,
      color: colors.textSupplementary,
      fontWeight: '500',
    },
    feeText: {
      fontSize: 13,
      color: colors.textSupplementary,
      textAlign: 'left',
      fontWeight: '500',
    },
    progressText: {
      fontSize: 14,
      color: colors.textBody,
      fontWeight: '500',
      textAlign: 'center',
    },
    // Failure explanation shown in-sheet when phase === 'failed', in
    // the same spot as progressText (which `finally` has cleared by then).
    errorText: {
      fontSize: 14,
      color: colors.red,
      fontWeight: '500',
      textAlign: 'center',
    },
    // --- Step list (issue #62) ---
    stepList: {
      alignSelf: 'stretch',
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 20,
      backgroundColor: colors.background,
      borderRadius: 12,
      marginTop: 8,
    },
    stepRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    stepIcon: {
      width: 24,
      height: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepLabel: {
      fontSize: 15,
      color: colors.textBody,
      fontWeight: '600',
      flex: 1,
    },
    stepLabelPending: {
      color: colors.textSupplementary,
      fontWeight: '500',
    },
    stepLabelFailed: {
      color: colors.red,
    },
    closeButton: {
      backgroundColor: colors.brandPink,
      height: 48,
      paddingHorizontal: 40,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 8,
    },
    closeButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
    closeButtonDisabled: {
      backgroundColor: colors.textSupplementary,
      opacity: 0.5,
    },
  });
