import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createGroupRowStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 12,
      gap: 12,
    },
    info: {
      flex: 1,
      minWidth: 0,
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 8,
    },
    name: {
      flex: 1,
      fontSize: 16,
      fontWeight: '600',
      color: colors.textHeader,
    },
    timestamp: {
      fontSize: 12,
      color: colors.textSupplementary,
    },
    preview: {
      flex: 1,
      fontSize: 13,
      color: colors.textSupplementary,
    },
    previewRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 2,
    },
    // Unread @mention marker (#1295) — Telegram's pink "@" circle.
    mentionBadge: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    mentionBadgeText: {
      width: '100%',
      textAlign: 'center',
      textAlignVertical: 'center',
      includeFontPadding: false,
      lineHeight: 20,
      color: colors.white,
      fontSize: 12,
      fontWeight: '800',
    },
  });
