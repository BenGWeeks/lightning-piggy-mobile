import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export type MessageInvoiceActionsStyles = ReturnType<typeof createMessageInvoiceActionsStyles>;

// Pay / QR / Copy affordance rendered beneath a received bolt11 invoice bubble
// (#948 follow-up). Mirrors OrderPaymentActions' controls so an invoice pasted
// into a DM (from any Nostr client) gets the same in-chat Pay + QR + copy as a
// marketplace order card, rather than sitting there as a bare "Pay" button.
export const createMessageInvoiceActionsStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      marginTop: 8,
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
    // Show QR / Copy sit on one row beneath Pay.
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
  });
