import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createNfcReadSheetStyles = (colors: Palette) =>
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
      flex: 1,
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
      flex: 1,
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
    readyIndicator: {
      marginBottom: 20,
    },
    successIcon: { backgroundColor: colors.greenLight },
    sleepingIcon: { backgroundColor: colors.brandPinkLight },
    // 'Zzz' label floats outside the top-right of the icon container,
    // above the Piggy rather than over its body. Negative offsets push
    // it past the circle's edge — the BottomSheetView clips overflow
    // gracefully, so the Zzz sits visually atop the corner like a
    // hand-drawn snore.
    zzzBadge: {
      position: 'absolute',
      top: -6,
      right: -8,
      color: colors.brandPink,
      fontSize: 24,
      fontWeight: '800',
      fontStyle: 'italic',
      letterSpacing: -1,
      transform: [{ rotate: '-10deg' }],
    },
    errorIcon: { backgroundColor: colors.redLight },
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
    countdown: {
      fontSize: 36,
      fontWeight: '800',
      color: colors.brandPink,
      fontVariant: ['tabular-nums'],
      marginBottom: 12,
    },
    primaryButton: {
      paddingHorizontal: 48,
      paddingVertical: 14,
      borderRadius: 10,
      backgroundColor: colors.brandPink,
    },
    primaryButtonText: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.white,
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
  });
