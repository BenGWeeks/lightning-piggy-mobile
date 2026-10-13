import { StyleSheet } from 'react-native';

import type { Palette } from './palettes';

export const createNotificationServerSectionStyles = (colors: Palette) =>
  StyleSheet.create({
    identity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    avatar: { width: 48, height: 48, borderRadius: 24 },
    avatarFallback: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.brandPinkLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    details: { flex: 1, gap: 6 },
    serverName: { color: colors.textHeader, fontSize: 15, fontWeight: '700' },
    defaultBadge: { color: colors.brandPink, fontSize: 12, fontWeight: '600' },
    copyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
    npub: { color: colors.textSupplementary, fontSize: 13, flexShrink: 1 },
    healthRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    healthFound: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green },
    healthUnknown: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.textSupplementary,
    },
    resetButton: { alignSelf: 'flex-start', paddingVertical: 10 },
    resetText: { color: colors.white, fontSize: 13, fontWeight: '600' },
    toggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 10,
      paddingVertical: 4,
    },
    toggleText: {
      flexShrink: 1,
      color: colors.white,
      fontSize: 13,
      fontWeight: '600',
    },
    card: {
      marginTop: 8,
      padding: 14,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
      gap: 8,
    },
    text: {
      fontSize: 13,
      color: colors.textSupplementary,
      flexShrink: 1,
    },
    serverInput: {
      borderWidth: 1,
      borderColor: colors.divider,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 13,
      color: colors.textHeader,
      backgroundColor: colors.background,
    },
    buttons: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    primaryButton: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 18,
      backgroundColor: colors.brandPink,
    },
    primaryButtonText: {
      color: colors.white,
      fontSize: 13,
      fontWeight: '700',
    },
  });

export type NotificationServerSectionStyles = ReturnType<
  typeof createNotificationServerSectionStyles
>;
