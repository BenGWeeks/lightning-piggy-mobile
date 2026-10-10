import { Platform, StyleSheet } from 'react-native';

import type { Palette } from './palettes';

export const createAccountSwitcherSheetStyles = (colors: Palette) =>
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
    content: {
      paddingHorizontal: 24,
      paddingTop: 8,
      paddingBottom: 32,
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.textHeader,
      marginBottom: 4,
    },
    subtitle: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginBottom: 16,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
    },
    rowMain: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      overflow: 'hidden',
      backgroundColor: colors.background,
    },
    avatarImage: {
      width: 44,
      height: 44,
      borderRadius: 22,
    },
    avatarPlaceholder: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowText: {
      flex: 1,
    },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    rowName: {
      color: colors.textHeader,
      fontSize: 16,
      fontWeight: '700',
      flexShrink: 1,
    },
    activeBadge: {
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowNpub: {
      color: colors.textSupplementary,
      fontSize: 12,
      marginTop: 2,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    signOutButton: {
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
      marginVertical: 12,
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
    },
    actionIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionLabel: {
      color: colors.textHeader,
      fontSize: 15,
      fontWeight: '600',
    },
  });
