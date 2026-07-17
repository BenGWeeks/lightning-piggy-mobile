import { StyleSheet } from 'react-native';

// Graffiti street-art robot — same transparent corner-mascot treatment as the
// Piggy / Bee / Cat cards: the splatter art sits over the card's gradient in
// the top-right, semi-transparent, rather than filling the whole card. Matches
// lightning-bee.ts / lightning-cat.ts so the robot reads as one of the graffiti
// family rather than a full-bleed photo card.
export const bgStyle = StyleSheet.create({
  full: {
    position: 'absolute',
    width: 300,
    height: 300,
    right: -40,
    top: -30,
    opacity: 0.75,
  },
});
