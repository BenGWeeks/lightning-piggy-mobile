import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createNotificationsScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.brandPink,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 20,
      paddingBottom: 40,
    },
    backButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(255,255,255,0.9)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    title: {
      flex: 1,
      color: colors.white,
      fontSize: 24,
      fontWeight: '600',
    },
    markAll: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
      backgroundColor: 'rgba(255,255,255,0.25)',
    },
    markAllText: {
      color: colors.white,
      fontSize: 13,
      fontWeight: '600',
    },
    content: {
      flex: 1,
      backgroundColor: colors.white,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      marginTop: -24,
      overflow: 'hidden',
    },
    listContent: {
      paddingVertical: 8,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 20,
      paddingVertical: 12,
    },
    rowUnread: {
      backgroundColor: colors.brandPinkLight,
    },
    iconCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.background,
      justifyContent: 'center',
      alignItems: 'center',
    },
    info: {
      flex: 1,
      minWidth: 0,
    },
    rowTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.textHeader,
    },
    rowSubtitle: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginTop: 2,
    },
    meta: {
      alignItems: 'flex-end',
      gap: 6,
    },
    time: {
      fontSize: 12,
      color: colors.textSupplementary,
    },
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.brandPink,
    },
    empty: {
      alignItems: 'center',
      paddingHorizontal: 32,
      paddingTop: 64,
      gap: 8,
    },
    emptyTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.textHeader,
    },
    emptyText: {
      fontSize: 14,
      color: colors.textSupplementary,
      textAlign: 'center',
    },
  });

export type NotificationsScreenStyles = ReturnType<typeof createNotificationsScreenStyles>;
