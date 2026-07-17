import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/**
 * Styles for {@link AuthorInline} — the avatar + display name shown for a
 * Nostr review/comment author. The avatar's size-dependent box (width/
 * height/radius, the fallback initial's font size) stays inline at the call
 * site; palette- and layout-driven rules live here.
 */
export const createAuthorInlineStyles = (colors: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flexShrink: 1,
    },
    avatar: {
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.surface,
      backgroundColor: 'rgba(127,127,127,0.12)',
    },
    fallback: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.brandPinkLight,
    },
    fallbackText: {
      fontWeight: '800',
      color: colors.brandPink,
    },
    name: {
      fontSize: 13,
      fontWeight: '700',
      flexShrink: 1,
      color: colors.textHeader,
    },
  });

export type AuthorInlineStyles = ReturnType<typeof createAuthorInlineStyles>;
