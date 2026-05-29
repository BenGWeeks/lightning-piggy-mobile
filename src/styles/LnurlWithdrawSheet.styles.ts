import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

// Styles for the global LNURL-withdraw claim bottom sheet (#341). Generic
// (gift-card / voucher) framing — deliberately NOT the Hunt/Piggy visual
// language, since a plain `lnurlw://` / `lightning:lnurl…` tag needn't be a
// geo-cache Piglet.
export const createLnurlWithdrawSheetStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: { backgroundColor: colors.surface },
    handle: { backgroundColor: colors.textSupplementary },
    content: {
      paddingHorizontal: 24,
      paddingTop: 8,
      paddingBottom: 32,
      alignItems: 'center',
      gap: 12,
    },
    iconWrap: {
      width: 96,
      height: 96,
      borderRadius: 48,
      backgroundColor: colors.brandPinkLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconWrapSuccess: {
      width: 96,
      height: 96,
      borderRadius: 48,
      backgroundColor: colors.greenLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.textHeader,
      textAlign: 'center',
    },
    memo: {
      fontSize: 15,
      color: colors.textSupplementary,
      textAlign: 'center',
      lineHeight: 22,
      fontStyle: 'italic',
    },
    fineprint: {
      fontSize: 12,
      color: colors.textSupplementary,
      textAlign: 'center',
    },
    amountValue: {
      fontSize: 30,
      fontWeight: '800',
      color: colors.textHeader,
      marginTop: 2,
    },
    amountFiat: { fontSize: 14, color: colors.textSupplementary },
    countdown: {
      fontSize: 36,
      fontWeight: '800',
      color: colors.brandPink,
      fontVariant: ['tabular-nums'],
      marginVertical: 4,
    },
    slider: { width: '100%', height: 40, marginTop: 4 },
    rangeRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      width: '100%',
      marginTop: -6,
    },
    rangeText: { fontSize: 12, color: colors.textSupplementary },
    amountInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
    amountInput: {
      minWidth: 130,
      borderWidth: 1,
      borderColor: colors.brandPink,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
      textAlign: 'center',
    },
    amountInputUnit: { fontSize: 15, color: colors.textSupplementary, fontWeight: '600' },
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.brandPink,
      paddingHorizontal: 28,
      paddingVertical: 16,
      borderRadius: 100,
      marginTop: 8,
      alignSelf: 'stretch',
    },
    primaryButtonText: { color: colors.white, fontSize: 16, fontWeight: '700' },
    secondaryButton: { paddingVertical: 12, paddingHorizontal: 24 },
    secondaryButtonText: { color: colors.brandPink, fontSize: 14, fontWeight: '700' },
  });

export type LnurlWithdrawSheetStyles = ReturnType<typeof createLnurlWithdrawSheetStyles>;
