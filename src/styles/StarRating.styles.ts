import { StyleSheet } from 'react-native';

// Star colours are applied inline per-glyph (filled vs empty), so these
// layout-only styles don't close over the palette.
export const createStarRatingStyles = () =>
  StyleSheet.create({
    starRow: {
      flexDirection: 'row',
      alignSelf: 'flex-start',
    },
    // Clips the filled glyph of a fractional star to its share of the box.
    partial: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
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
