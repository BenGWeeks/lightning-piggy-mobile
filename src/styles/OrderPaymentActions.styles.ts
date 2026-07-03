import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export type OrderPaymentActionsStyles = ReturnType<typeof createOrderPaymentActionsStyles>;

// Pay / QR affordance shown under a marketplace order card (#market follow-up
// to #925). Visually a continuation of the `orderCard` in
// ConversationScreen.styles — a thin divider, then the action controls — so it
// reads as part of the same card rather than a detached block.
export const createOrderPaymentActionsStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      marginTop: 10,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      gap: 8,
    },
    payButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: colors.brandPink,
    },
    payButtonText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.white,
    },
    // Secondary controls (Show QR / Copy) sit on one row beneath Pay.
    secondaryRow: {
      flexDirection: 'row',
      gap: 8,
    },
    secondaryButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 9,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.brandPink,
      backgroundColor: 'transparent',
    },
    secondaryButtonText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.brandPink,
    },
    qrWrap: {
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 12,
      backgroundColor: colors.white,
      borderRadius: 12,
      alignSelf: 'center',
    },
    qrHint: {
      fontSize: 11,
      color: colors.textSupplementary,
      marginTop: 8,
      textAlign: 'center',
    },
    // "Paid ✓" pill — both a kind-17 receipt and a settled kind-16 request.
    paidBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 12,
      backgroundColor: colors.greenLight,
    },
    paidBadgeText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.greenDark,
      letterSpacing: 0.3,
    },
    expiredText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSupplementary,
    },
  });
