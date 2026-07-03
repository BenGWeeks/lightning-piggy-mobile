import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

// Presentation for the DM delivery-detail sheet (#856) — the per-relay
// breakdown + event metadata shown on long-pressing a sent bubble. Pure data,
// no state closure, so it lives here per the styles-in-their-own-file rule.
export const createDeliveryDetailSheetStyles = (colors: Palette) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: 'rgba(21, 23, 26, 0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 28,
      paddingVertical: 28,
      paddingHorizontal: 24,
      minWidth: 280,
      maxWidth: 360,
      gap: 14,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.2,
      shadowRadius: 24,
      elevation: 12,
    },
    header: {
      alignItems: 'center',
      gap: 10,
    },
    iconSlot: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
      textAlign: 'center',
    },
    // One relay row: coloured glyph + relay label, left-aligned.
    relayList: {
      gap: 6,
    },
    relayRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    relayLabel: {
      fontSize: 14,
      color: colors.textBody,
      flexShrink: 1,
    },
    relayLabelFailed: {
      color: colors.textSupplementary,
    },
    // Divider + metadata block (Event ID, Kind, Status).
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
      marginVertical: 2,
    },
    metaBlock: {
      gap: 8,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    metaLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSupplementary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    metaValue: {
      fontSize: 13,
      color: colors.textBody,
      flexShrink: 1,
      textAlign: 'right',
    },
    metaValueMono: {
      fontFamily: 'monospace',
      fontSize: 12,
    },
    copyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexShrink: 1,
      justifyContent: 'flex-end',
    },
    buttonRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 4,
    },
    button: {
      flexDirection: 'row',
      gap: 6,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.brandPink,
    },
    buttonInRow: {
      flex: 1,
    },
    // Re-send is a secondary action — brand-pink ink on a soft pink fill.
    buttonSecondary: {
      backgroundColor: colors.brandPinkLight,
    },
    buttonPressed: {
      opacity: 0.75,
    },
    buttonText: {
      fontSize: 16,
      fontWeight: '700',
      letterSpacing: 0.3,
      color: colors.white,
    },
    buttonTextSecondary: {
      color: colors.brandPink,
    },
  });

export type DeliveryDetailSheetStyles = ReturnType<typeof createDeliveryDetailSheetStyles>;
