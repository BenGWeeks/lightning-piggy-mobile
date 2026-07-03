import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const AVATAR_SIZE = 40;

export const createTransactionListStyles = (colors: Palette) =>
  StyleSheet.create({
    list: {
      flex: 1,
    },
    emptyContainer: {
      padding: 40,
      alignItems: 'center',
    },
    emptyText: {
      color: colors.textSupplementary,
      fontSize: 16,
    },
    dayHeader: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSupplementary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 6,
    },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      paddingHorizontal: 16,
      gap: 12,
    },
    avatarWrap: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
    },
    avatar: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: AVATAR_SIZE / 2,
      backgroundColor: colors.background,
    },
    avatarPlaceholder: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: AVATAR_SIZE / 2,
      backgroundColor: colors.brandPinkLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarPlaceholderIcon: {
      fontSize: 20,
      color: colors.brandPink,
    },
    centerCol: {
      flex: 1,
      minWidth: 0,
    },
    centerLine: {
      flexDirection: 'row',
      alignItems: 'baseline',
    },
    primary: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textHeader,
      flexShrink: 1,
    },
    time: {
      fontSize: 12,
      color: colors.textSupplementary,
      marginLeft: 4,
    },
    subtitle: {
      fontSize: 12,
      color: colors.textSupplementary,
      marginTop: 2,
    },
    rightCol: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    amountsColumn: {
      alignItems: 'flex-end',
    },
    amount: {
      fontSize: 15,
      fontWeight: '700',
    },
    arrow: {
      fontSize: 22,
      fontWeight: '700',
    },
    fiat: {
      fontSize: 11,
      color: colors.textSupplementary,
      marginTop: 1,
    },
    footerSpinner: {
      paddingVertical: 16,
      alignItems: 'center',
    },
    incoming: {
      color: colors.green,
    },
    outgoing: {
      color: colors.red,
    },
    itemPending: {
      opacity: 0.5,
    },
    pendingText: {
      color: colors.textSupplementary,
    },
  });

export type TransactionListStyles = ReturnType<typeof createTransactionListStyles>;
