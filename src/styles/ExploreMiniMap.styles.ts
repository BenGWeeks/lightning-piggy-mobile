import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createExploreMiniMapStyles = (colors: Palette) =>
  StyleSheet.create({
    // First-paint placeholder matches the map geometry.
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
    deniedCopy: { flex: 1 },
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
