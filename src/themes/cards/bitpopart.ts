import { StyleSheet } from 'react-native';

// Pop-art ostrich on a halftone comic burst. Unlike the line-art mascots
// (a square decoration tucked into a corner over the gradient) this is a
// full-bleed photo background: the box fills the entire card and the image
// is drawn with resizeMode 'cover' (set in cardThemes) so the burst reaches
// all four edges with no gradient gap. Slightly under full opacity keeps the
// white card text readable over the brightest parts of the art.
export const bgStyle = StyleSheet.create({
  full: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    opacity: 0.9,
  },
});
