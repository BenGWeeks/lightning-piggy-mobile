import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

// Presentation for MessageBubble + its ImageBubble sub-component. Extracted
// from the component (#703 size cap) — pure data, no state closure.
export const createMessageBubbleStyles = (colors: Palette) =>
  StyleSheet.create({
    bubbleRow: {
      flexDirection: 'row',
      marginVertical: 2,
    },
    bubbleRowLeft: { justifyContent: 'flex-start' },
    bubbleRowRight: { justifyContent: 'flex-end' },
    senderLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textSupplementary,
      marginBottom: 2,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    bubble: {
      maxWidth: '80%',
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 4,
      borderRadius: 16,
    },
    bubbleThem: {
      backgroundColor: colors.surface,
      borderBottomLeftRadius: 4,
    },
    bubbleMe: {
      backgroundColor: colors.brandPink,
      borderBottomRightRadius: 4,
    },
    bubbleText: {
      fontSize: 15,
      color: colors.textBody,
      lineHeight: 20,
    },
    bubbleTextMe: {
      color: colors.white,
    },
    // Tappable URL span inside a received bubble (surface bg) — brand accent.
    bubbleLink: {
      color: colors.brandPink,
      textDecorationLine: 'underline',
    },
    // …and inside a sent bubble (pink bg) — white so it stays legible.
    bubbleLinkMe: {
      color: colors.white,
      textDecorationLine: 'underline',
      fontWeight: '600',
    },
    bubbleTime: {
      fontSize: 10,
      color: colors.textSupplementary,
      marginTop: 4,
      alignSelf: 'flex-end',
    },
    bubbleTimeMe: {
      color: 'rgba(255,255,255,0.85)',
    },
    invoiceCard: {
      width: 240,
      paddingTop: 12,
      paddingBottom: 4,
      paddingHorizontal: 14,
      borderRadius: 14,
      gap: 6,
    },
    invoiceCardMe: {
      backgroundColor: colors.brandPink,
    },
    invoiceCardThem: {
      backgroundColor: colors.surface,
    },
    invoiceLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSupplementary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    invoiceLabelMe: {
      color: 'rgba(255,255,255,0.85)',
    },
    invoiceAmount: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.textHeader,
      marginTop: 2,
    },
    invoiceAmountMe: {
      color: colors.white,
    },
    invoiceMemo: {
      fontSize: 14,
      color: colors.textBody,
      marginTop: 2,
    },
    invoiceMemoMe: {
      color: 'rgba(255,255,255,0.9)',
    },
    invoiceExpiry: {
      fontSize: 12,
      color: colors.textSupplementary,
      marginTop: 4,
    },
    invoiceExpiryMe: {
      color: 'rgba(255,255,255,0.75)',
    },
    invoiceTagRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 6,
    },
    invoiceTag: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 10,
      alignSelf: 'flex-start',
    },
    invoiceTagPaid: {
      backgroundColor: '#2e7d32',
    },
    invoiceTagPaidText: {
      fontSize: 11,
      fontWeight: '700',
      color: '#ffffff',
      letterSpacing: 0.3,
    },
    invoiceTagUnpaid: {
      backgroundColor: 'rgba(255,255,255,0.22)',
    },
    invoiceTagUnpaidText: {
      fontSize: 11,
      fontWeight: '700',
      color: '#ffffff',
      letterSpacing: 0.3,
    },
    invoiceTagExpired: {
      backgroundColor: 'rgba(0,0,0,0.32)',
    },
    invoiceTagExpiredText: {
      fontSize: 11,
      fontWeight: '700',
      color: '#ffffff',
      letterSpacing: 0.3,
    },
    invoicePayButton: {
      marginTop: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: colors.brandPink,
    },
    invoicePayText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.white,
    },
    contactCard: {
      maxWidth: '85%',
      minWidth: 240,
      paddingTop: 12,
      paddingBottom: 4,
      paddingHorizontal: 14,
      borderRadius: 14,
      borderWidth: 1,
      gap: 10,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
    },
    contactCardMe: {
      backgroundColor: colors.brandPink,
      borderColor: colors.brandPink,
    },
    contactCardThem: {
      backgroundColor: colors.surface,
      borderColor: colors.divider,
    },
    contactLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSupplementary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    contactLabelMe: {
      color: 'rgba(255,255,255,0.85)',
    },
    contactBodyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    contactAvatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.background,
    },
    contactAvatarFallback: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    contactInfo: {
      flex: 1,
      minWidth: 0,
    },
    contactName: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textHeader,
    },
    contactNameMe: {
      color: colors.white,
    },
    contactLn: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginTop: 2,
    },
    contactLnMe: {
      color: 'rgba(255,255,255,0.9)',
    },
    gifCard: {
      maxWidth: '85%',
      minWidth: 240,
      borderRadius: 14,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
    },
    gifCardMe: {
      backgroundColor: colors.brandPink,
    },
    gifCardThem: {
      backgroundColor: colors.surface,
    },
    gifImage: {
      width: 240,
      height: 240,
      backgroundColor: colors.background,
    },
    gifTime: {
      fontSize: 10,
      color: colors.textSupplementary,
      alignSelf: 'flex-end',
      paddingHorizontal: 14,
      paddingVertical: 4,
    },
    gifTimeMe: {
      color: 'rgba(255,255,255,0.85)',
    },
    locationCard: {
      maxWidth: '85%',
      minWidth: 240,
      borderRadius: 14,
      borderWidth: 1,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
    },
    locationCardMe: {
      backgroundColor: colors.brandPink,
      borderColor: colors.brandPink,
    },
    locationCardThem: {
      backgroundColor: colors.surface,
      borderColor: colors.divider,
    },
    locationMap: {
      width: '100%',
      height: 140,
      backgroundColor: colors.background,
    },
    locationBody: {
      paddingHorizontal: 14,
      paddingTop: 10,
      paddingBottom: 4,
      gap: 2,
    },
    locationLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    locationLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSupplementary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    locationLabelMe: {
      color: 'rgba(255,255,255,0.85)',
    },
    locationCoords: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.textHeader,
      marginTop: 2,
    },
    locationCoordsMe: {
      color: colors.white,
    },
    locationAccuracy: {
      fontSize: 12,
      color: colors.textSupplementary,
    },
    locationAccuracyMe: {
      color: 'rgba(255,255,255,0.85)',
    },
    imageBubble: {
      maxWidth: '85%',
      minWidth: 240,
      borderRadius: 14,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
    },
    imageBubbleMe: {
      backgroundColor: colors.brandPink,
    },
    imageBubbleThem: {
      backgroundColor: colors.surface,
    },
    imageBubbleImage: {
      width: 240,
      height: 240,
      backgroundColor: colors.background,
    },
    imageBubbleTime: {
      fontSize: 10,
      color: colors.textSupplementary,
      alignSelf: 'flex-end',
      paddingHorizontal: 14,
      paddingVertical: 4,
    },
    imageBubbleTimeMe: {
      color: 'rgba(255,255,255,0.85)',
    },
  });

export type MessageBubbleStyles = ReturnType<typeof createMessageBubbleStyles>;
