import { StyleSheet } from 'react-native';

// Star colours are applied inline per-glyph (filled vs empty), so these
// layout-only styles don't close over the palette.
export const createStarRatingStyles = () =>
  StyleSheet.create({
    starRow: {
      flexDirection: 'row',
      position: 'relative',
    },
    overlay: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      flexDirection: 'row',
      overflow: 'hidden',
    },
    inputRow: {
      flexDirection: 'row',
      gap: 6,
    },
    inputStar: {
      padding: 2,
    },
  });

export type StarRatingStyles = ReturnType<typeof createStarRatingStyles>;
