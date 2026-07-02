import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/** Styles for the in-app Market checkout bottom sheet (#market). */
export const createMarketCheckoutSheetStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.background,
    },
    handle: {
      backgroundColor: colors.divider,
      width: 40,
    },
    container: {
      paddingHorizontal: 20,
      paddingTop: 4,
      paddingBottom: 28,
    },
    title: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.textHeader,
      marginBottom: 16,
    },
    productRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 20,
    },
    thumb: {
      width: 56,
      height: 56,
      borderRadius: 12,
      backgroundColor: colors.surface,
    },
    thumbFallback: {
      width: 56,
      height: 56,
      borderRadius: 12,
      backgroundColor: colors.brandPinkLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    thumbFallbackText: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.brandPink,
    },
    productInfo: {
      flex: 1,
    },
    productTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.textHeader,
    },
    productSeller: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginTop: 2,
    },
    unitPrice: {
      fontSize: 13,
      color: colors.textBody,
      marginTop: 4,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 18,
    },
    rowLabel: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.textBody,
    },
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
    },
    stepButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 1.5,
      borderColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepButtonDisabled: {
      borderColor: colors.divider,
    },
    qtyText: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
      minWidth: 24,
      textAlign: 'center',
    },
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    summaryLabel: {
      fontSize: 14,
      color: colors.textSupplementary,
    },
    summaryValue: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textBody,
    },
    totalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: 14,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      marginBottom: 20,
    },
    totalLabel: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textHeader,
    },
    totalValue: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    totalSats: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.textHeader,
    },
    totalFiat: {
      fontSize: 13,
      color: colors.textSupplementary,
    },
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.brandPink,
      borderRadius: 14,
      paddingVertical: 15,
    },
    primaryButtonDisabled: {
      opacity: 0.6,
    },
    primaryButtonText: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.white,
    },
    hint: {
      fontSize: 13,
      color: colors.textSupplementary,
      textAlign: 'center',
      marginTop: 12,
      lineHeight: 18,
    },
    errorText: {
      fontSize: 13,
      color: colors.red,
      textAlign: 'center',
      marginTop: 12,
    },
    sentWrap: {
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
    },
    sentBadge: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.greenLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sentTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
    },
    sentBody: {
      fontSize: 14,
      color: colors.textBody,
      textAlign: 'center',
      lineHeight: 20,
      paddingHorizontal: 8,
    },
    fallbackLink: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: 16,
      paddingVertical: 8,
    },
    fallbackLinkText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.brandPink,
    },
  });

export type MarketCheckoutSheetStyles = ReturnType<typeof createMarketCheckoutSheetStyles>;
