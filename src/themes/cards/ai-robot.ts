import { StyleSheet } from 'react-native';

// Friendly AI robot mascot filling the whole card. Like the spaceship card
// (and unlike the corner-decoration mascots) this is full-bleed art: the
// emerald-to-teal gradient with the waving robot IS the background, so the
// bgStyle uses absoluteFillObject to reach every edge despite the card's
// padding:20. Paired with resizeMode 'cover' (cardThemes) so the ~1.5:1 art
// fills the ~1.9:1 card with a slight top/bottom crop; the robot sits to the
// right and the calmer, darker left keeps the white balance text readable.
export const bgStyle = StyleSheet.create({
  full: {
    ...StyleSheet.absoluteFillObject,
  },
});
