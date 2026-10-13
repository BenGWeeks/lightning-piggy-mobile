import { Platform, StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createWalletSettingsSheetStyles = (colors: Palette) =>
  StyleSheet.create({
    tabContent: { gap: 8 },
    pickerGap: { marginTop: 4 },
    credentialAction: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sheetBackground: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    handle: {
      backgroundColor: colors.divider,
      width: 40,
    },
    // Fixed header region (title + segmented control) above the scrolling
    // tab content. Horizontal padding matches the scroll content so the
    // control lines up with the fields below it.
    header: {
      paddingHorizontal: 24,
      paddingTop: 8,
    },
    content: {
      padding: 24,
      paddingTop: 12,
      gap: 8,
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.textHeader,
      marginBottom: 16,
    },
    // Segmented control (Design / Details / Connection). A pill-shaped
    // row of equal-width buttons; the active segment gets a filled
    // surface so only one tab's content shows at a time.
    segmentedControl: {
      flexDirection: 'row',
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 4,
      gap: 4,
    },
    segment: {
      flex: 1,
      height: 40,
      borderRadius: 9,
      justifyContent: 'center',
      alignItems: 'center',
    },
    segmentActive: {
      backgroundColor: colors.surface,
    },
    segmentText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSupplementary,
    },
    segmentTextActive: {
      color: colors.brandPink,
    },

    input: {
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 16,
      fontSize: 16,
      color: colors.textBody,
    },
    xpubText: {
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 16,
      fontSize: 12,
      color: colors.textSupplementary,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    nwcRow: {
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    nwcRowText: {
      flex: 1,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13,
      color: colors.textBody,
    },
    qrPanel: {
      backgroundColor: colors.white,
      borderRadius: 12,
      padding: 16,
      alignItems: 'center',
      gap: 12,
      marginTop: 8,
    },
    qrHint: {
      fontSize: 12,
      color: colors.textSupplementary,
      textAlign: 'center',
    },
    hintText: {
      fontSize: 12,
      color: colors.textSupplementary,
      marginTop: 4,
    },
    copyHint: {
      fontSize: 12,
      color: colors.brandPink,
      fontWeight: '600',
      marginTop: 4,
      textAlign: 'right',
    },

    // Fixed footer holding the always-visible Remove button, below the
    // scrolling tab content and separated by a hairline divider.
    footer: {
      paddingHorizontal: 24,
      paddingTop: 8,
      paddingBottom: Platform.OS === 'ios' ? 24 : 16,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },

    recoveryCallout: {
      marginTop: 20,
      backgroundColor: colors.brandPinkLight,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.brandPink,
      padding: 16,
      gap: 8,
    },

    credentialRow: {
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    credentialText: {
      flex: 1,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 15,
      color: colors.textBody,
    },

    recoveryErrorText: {
      color: colors.red,
      fontSize: 13,
      fontWeight: '600',
      textAlign: 'center',
    },
    // Empty-state text for a tab that has nothing to show for the
    // current wallet type (e.g. Connection for an on-chain wallet with
    // only an xpub, or when no recovery/NWC data is present).
    emptyTabText: {
      fontSize: 14,
      color: colors.textSupplementary,
      textAlign: 'center',
      marginTop: 24,
    },
  });

export type WalletSettingsSheetStyles = ReturnType<typeof createWalletSettingsSheetStyles>;
