import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createCreateGroupSheetStyles = (colors: Palette) =>
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
    container: {
      flex: 1,
    },
    header: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginTop: 4,
      textAlign: 'center',
    },
    searchInput: {
      marginTop: 12,
      backgroundColor: colors.background,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.textHeader,
    },
    listWithBar: {
      flex: 1,
      flexDirection: 'row',
      overflow: 'hidden',
    },
    list: {
      flex: 1,
    },
    listContent: {
      paddingVertical: 4,
      paddingHorizontal: 20,
      // Reserve space at the bottom for the absolute-positioned footer
      // (52dp button + 12dp top padding + 24dp bottom padding + a 16dp
      // breathing room above the button so the last visible row isn't
      // partially hidden behind the gradient/separator). Without this,
      // BottomSheetView's flex layout collapses our footer's measured
      // height when the FlatList claims `flex: 1` inside an
      // `enableDynamicSizing={false}` sheet.
      paddingBottom: 120,
    },
    nameStepBody: {
      paddingHorizontal: 24,
      paddingTop: 16,
      flex: 1,
    },
    summary: {
      backgroundColor: colors.background,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 20,
    },
    avatarStrip: {
      flexDirection: 'row',
      gap: 6,
      marginBottom: 8,
    },
    summaryAvatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.surface,
      justifyContent: 'center',
      alignItems: 'center',
      overflow: 'hidden',
    },
    summaryAvatarImage: {
      width: 32,
      height: 32,
      borderRadius: 16,
    },
    summaryOverflow: {
      backgroundColor: colors.brandPinkLight,
    },
    summaryOverflowText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.brandPink,
    },
    summaryText: {
      fontSize: 13,
      color: colors.textBody,
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSupplementary,
      marginBottom: 6,
    },
    input: {
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 14,
      fontSize: 15,
      color: colors.textBody,
      fontWeight: '500',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      gap: 12,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.background,
      justifyContent: 'center',
      alignItems: 'center',
      overflow: 'hidden',
    },
    avatarImage: {
      width: 40,
      height: 40,
      borderRadius: 20,
    },
    rowName: {
      flex: 1,
      fontSize: 15,
      fontWeight: '600',
      color: colors.textHeader,
    },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: colors.divider,
      justifyContent: 'center',
      alignItems: 'center',
    },
    checkboxActive: {
      backgroundColor: colors.brandPink,
      borderColor: colors.brandPink,
    },
    empty: {
      padding: 24,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 14,
      color: colors.textSupplementary,
      textAlign: 'center',
      fontStyle: 'italic',
    },
    footer: {
      // Pin the footer to the bottom of the sheet so the FlatList's
      // `flex: 1` can't squeeze it out (BottomSheetView's flex layout
      // ignores measured child heights when nested under
      // `enableDynamicSizing={false}` + a snap-locked sheet). The
      // FlatList compensates with `listContent.paddingBottom` so the
      // last row isn't hidden behind this footer.
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: 24,
      paddingTop: 12,
      paddingBottom: 24,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      backgroundColor: colors.surface,
    },
    footerRow: {
      flexDirection: 'row',
      gap: 12,
      paddingHorizontal: 24,
      paddingTop: 12,
      paddingBottom: 24,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      backgroundColor: colors.surface,
    },
    primaryButton: {
      backgroundColor: colors.brandPink,
      height: 52,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 24,
    },
    primaryButtonFlex: {
      flex: 1,
    },
    primaryButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
    secondaryButton: {
      backgroundColor: colors.background,
      height: 52,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 24,
    },
    secondaryButtonText: {
      color: colors.textBody,
      fontSize: 16,
      fontWeight: '600',
    },
    disabled: {
      opacity: 0.5,
    },
    protocolLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSupplementary,
      marginTop: 20,
      marginBottom: 6,
    },
    protocolRow: {
      flexDirection: 'row',
      gap: 10,
    },
    protocolOption: {
      flex: 1,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: colors.background,
      backgroundColor: colors.background,
      paddingVertical: 10,
      paddingHorizontal: 12,
      gap: 2,
    },
    protocolOptionActive: {
      borderColor: colors.brandPink,
    },
    protocolName: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textHeader,
    },
    protocolBadge: {
      fontSize: 12,
      color: colors.courseTeal,
    },
    protocolHint: {
      fontSize: 12,
      lineHeight: 17,
      color: colors.textSupplementary,
      marginTop: 8,
    },
  });

export type CreateGroupSheetStyles = ReturnType<typeof createCreateGroupSheetStyles>;
