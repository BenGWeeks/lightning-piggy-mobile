import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createExploreMiniMapStyles = (colors: Palette) =>
  StyleSheet.create({
    // Unfocused placeholder. Mirrors LibreMiniMap's `container` (height 200,
    // 16dp side margins, 18dp bottom gap, 14dp radius) so the rail layout
    // below doesn't shift when the GL map mounts / unmounts on focus changes
    // (#778). Brand-pink surface so the empty slot still reads as our UI.
    placeholder: {
      height: 200,
      marginHorizontal: 16,
      marginBottom: 18,
      borderRadius: 14,
      overflow: 'hidden',
      backgroundColor: colors.brandPink,
    },
    deniedCard: {
      flexDirection: 'row',
      gap: 12,
      backgroundColor: colors.surface,
      marginHorizontal: 16,
      marginBottom: 18,
      padding: 14,
      borderRadius: 12,
      alignItems: 'flex-start',
    },
    deniedTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textHeader,
    },
    deniedSub: {
      fontSize: 12,
      color: colors.textSupplementary,
      marginTop: 4,
      lineHeight: 17,
    },
  });

export type ExploreMiniMapStyles = ReturnType<typeof createExploreMiniMapStyles>;
