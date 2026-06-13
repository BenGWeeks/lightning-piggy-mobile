import { StyleSheet } from 'react-native';

// Pop-art ostrich on a halftone comic burst. Unlike the line-art mascots
// (square, ~0.75 opacity) this is a busy full-colour 16:9 image, so the box
// keeps the source's ~1.78:1 aspect to avoid distortion and sits higher
// opacity / further right so the burst fills the card behind the text.
export const bgStyle = StyleSheet.create({
  full: {
    position: 'absolute',
    width: 360,
    height: 203,
    right: -30,
    top: 10,
    opacity: 0.9,
  },
});
