import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

const CARD_RADIUS = 24;
const INNER_RADIUS_BOTTOM = 20;
const SWAP_DIAMETER = 48;

export const createAmountEntryStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      // No `flex: 1` — when rendered inside a dynamic-sized
      // BottomSheetScrollView (parent's height is derived from children's
      // intrinsic height), `flex: 1` has nothing to fill against and
      // collapses the container, clipping the keypad. Natural stacking
      // lets the component declare its own height from its children.
      width: '100%',
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 20,
      paddingTop: 4,
      paddingBottom: 12,
    },
    backButton: {
      position: 'absolute',
      left: 12,
      top: 0,
      padding: 8,
    },
    title: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textHeader,
      textAlign: 'center',
    },
    topArea: {
      paddingHorizontal: 16,
    },
    card: {
      position: 'relative',
      backgroundColor: colors.surface,
      borderRadius: CARD_RADIUS,
      borderWidth: 1,
      borderColor: colors.background,
      overflow: 'visible',
    },
    primarySection: {
      paddingTop: 14,
      paddingBottom: 18,
      paddingHorizontal: 20,
      paddingRight: SWAP_DIAMETER + 24,
      borderTopLeftRadius: CARD_RADIUS,
      borderTopRightRadius: CARD_RADIUS,
    },
    secondarySection: {
      marginHorizontal: 8,
      marginBottom: 8,
      backgroundColor: colors.background,
      paddingTop: 14,
      paddingBottom: 18,
      paddingHorizontal: 16,
      paddingRight: SWAP_DIAMETER + 20,
      borderTopLeftRadius: 4,
      borderTopRightRadius: 4,
      borderBottomLeftRadius: INNER_RADIUS_BOTTOM,
      borderBottomRightRadius: INNER_RADIUS_BOTTOM,
    },
    cardRowTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    label: {
      fontSize: 15,
      fontWeight: '400',
      color: colors.textSupplementary,
    },
    pill: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
      minWidth: 52,
      alignItems: 'center',
    },
    pillPrimary: {
      backgroundColor: colors.background,
    },
    pillSecondary: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.background,
    },
    pillText: {
      fontSize: 14,
      fontWeight: '500',
      color: colors.textSupplementary,
      letterSpacing: 0.5,
    },
    amountValue: {
      fontSize: 44,
      fontWeight: '700',
      letterSpacing: 0.5,
      textAlign: 'right',
      marginTop: 4,
      includeFontPadding: false,
    },
    amountValuePrimary: {
      color: colors.brandPink,
    },
    amountValueSecondary: {
      color: colors.textSupplementary,
    },
    swapButton: {
      position: 'absolute',
      top: '50%',
      right: 16,
      width: SWAP_DIAMETER,
      height: SWAP_DIAMETER,
      borderRadius: SWAP_DIAMETER / 2,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      transform: [{ translateY: -SWAP_DIAMETER / 2 }],
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.12,
      shadowRadius: 6,
      elevation: 3,
    },
    rangeText: {
      fontSize: 12,
      color: colors.textSupplementary,
      textAlign: 'center',
      marginTop: 10,
    },
    warningText: {
      fontSize: 12,
      color: colors.red,
      textAlign: 'center',
      marginTop: 6,
    },
    confirmButton: {
      marginTop: 16,
      marginHorizontal: 16,
      // Match the horizontal gap so the button has the same 16 DP breathing
      // room above the keypad as it does to the left/right screen edges.
      marginBottom: 16,
      height: 52,
      backgroundColor: colors.brandPink,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.15,
      shadowRadius: 12,
      elevation: 4,
    },
    confirmButtonDisabled: {
      opacity: 0.5,
    },
    confirmButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
    keypad: {
      // `marginTop: 'auto'` (push to bottom of a flexed parent) removed
      // together with the container's `flex: 1` — stacking naturally
      // after the confirm button so the sheet's dynamic sizing measures
      // the full height correctly.
      backgroundColor: colors.divider,
      paddingHorizontal: 6,
      paddingTop: 6,
      paddingBottom: 8,
    },
    keypadRow: {
      flexDirection: 'row',
      gap: 5,
      marginBottom: 5,
    },
    key: {
      flex: 1,
      height: 46,
      borderRadius: 6,
      alignItems: 'center',
      justifyContent: 'center',
    },
    keyFilled: {
      backgroundColor: colors.surface,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.25,
      shadowRadius: 0,
      elevation: 1,
    },
    keyDigit: {
      fontSize: 25,
      fontWeight: '400',
      color: colors.textHeader,
      textAlign: 'center',
      includeFontPadding: false,
      lineHeight: 28,
    },
    keyLetters: {
      fontSize: 9,
      fontWeight: '700',
      color: colors.textHeader,
      letterSpacing: 1.6,
      textAlign: 'center',
      marginTop: 0,
    },
  });
