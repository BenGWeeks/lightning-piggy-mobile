import { StyleSheet } from 'react-native';

// Star colours are applied inline per-glyph (filled vs empty), so these
// layout-only styles don't close over the palette.
export const createStarRatingStyles = () =>
  StyleSheet.create({
    starRow: {
      flexDirection: 'row',
      position: 'relative',
      // Hug the five glyphs: the row must NOT stretch to the parent's width,
      // or the overlay's percentage width fills the wrong number of stars.
      alignSelf: 'flex-start',
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
