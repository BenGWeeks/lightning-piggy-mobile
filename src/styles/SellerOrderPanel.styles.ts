import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/** Seller's view of an incoming order inside the conversation order card. */
export const createSellerOrderPanelStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      marginTop: 10,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      gap: 6,
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    heading: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSupplementary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    lineRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
    lineTitle: { flex: 1, fontSize: 14, color: colors.textHeader },
    lineAmount: { fontSize: 14, color: colors.textBody },
    lineSub: { fontSize: 12, color: colors.textSupplementary },
    totalRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      marginTop: 4,
    },
    totalLabel: { fontSize: 14, fontWeight: '700', color: colors.textHeader },
    totalValue: { alignItems: 'flex-end' },
    totalSats: { fontSize: 17, fontWeight: '800', color: colors.textHeader },
    totalFiat: { fontSize: 12, color: colors.textSupplementary },
    detail: { fontSize: 13, color: colors.textBody },
    detailLabel: { fontWeight: '700' },
    warning: {
      fontSize: 12,
      color: colors.textBody,
      backgroundColor: colors.zapYellowLight,
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    muted: { fontSize: 13, color: colors.textSupplementary, fontStyle: 'italic' },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.brandPink,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 9,
    },
    primaryButtonText: { color: colors.white, fontWeight: '700', fontSize: 14 },
    secondaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderWidth: 1,
      borderColor: colors.brandPink,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    secondaryButtonText: { color: colors.brandPink, fontWeight: '700', fontSize: 14 },
    buttonDisabled: { opacity: 0.5 },
  });

export type SellerOrderPanelStyles = ReturnType<typeof createSellerOrderPanelStyles>;
