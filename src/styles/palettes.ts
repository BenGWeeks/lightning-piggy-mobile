// Light and dark colour palettes. The key set must stay identical between the
// two objects so every `colors.X` lookup resolves in either theme. Add new
// entries to both palettes.

export const lightPalette = {
  brandPink: '#EC008C',
  brandPinkLight: '#FFF0F5',
  white: '#FFFFFF',
  background: '#F5F5F5',
  surface: '#FFFFFF',
  textHeader: '#15171A',
  textBody: '#333333',
  textSupplementary: '#7C8B9A',
  divider: '#DDE1E3',
  green: '#4CAF50',
  greenLight: '#E8F5E9',
  greenDark: '#2E7D32',
  red: '#F44336',
  redLight: '#FFEBEE',
  courseTeal: '#109AB8',
  bitcoinOrange: '#F7931A',
  bitcoinOrangeLight: '#FFF1E0',
  boltzNavy: '#232742',
  zapYellow: '#FFC107',
  // Ink used INSIDE the yellow `zapYellow` surface (e.g. the attention
  // badge glyph). Always a dark colour regardless of theme — `textHeader`
  // is near-white in dark mode and would fail contrast against yellow.
  zapYellowInk: '#15171A',
  // Warning-callout surface + ink. Pairs with `zapYellow` for the badge
  // and matches the Bootstrap-style alert convention readers recognise.
  zapYellowLight: '#FFF3CD',
  zapYellowDark: '#856404',
  // Map-pin accent colours used by LibreMiniMap + LegendSheet. Promoting
  // these to palette tokens so the theme owns them (was inline hex on
  // map pin + legend chip styles).
  cachePurple: '#7A5CFF',
  eventViolet: '#5B3AFF',
  // Lightning Piggy card purple (the lighter top of the card's
  // #9B40FF -> #7A30F3 gradient). Used by the offline banner so it reads
  // as the brand's Nostr violet rather than the hot-pink alert colour.
  brandPurple: '#9B40FF',
};

// Dark palette: keep the Lightning Piggy brand hot-pink intact, swap the
// greyscale chrome for tuned dark-grey values (AA contrast against white
// text). `white` keeps its literal name since many components use it as
// an explicit foreground colour on pink/orange backgrounds.
export const darkPalette: typeof lightPalette = {
  brandPink: '#EC008C',
  brandPinkLight: '#3A1028',
  white: '#FFFFFF',
  background: '#0E1013',
  surface: '#1A1D21',
  textHeader: '#F5F6F7',
  textBody: '#D5D8DC',
  textSupplementary: '#8A95A3',
  divider: '#2A2E34',
  green: '#66BB6A',
  greenLight: '#1B3A1F',
  greenDark: '#A5D6A7',
  red: '#EF5350',
  redLight: '#3A1010',
  courseTeal: '#2EB8D6',
  bitcoinOrange: '#F7931A',
  bitcoinOrangeLight: '#3A2410',
  boltzNavy: '#3A3F5C',
  zapYellow: '#FFC107',
  // Same dark ink as the light palette — the yellow surface stays bright
  // in both themes so the glyph on top should stay dark in both.
  zapYellowInk: '#15171A',
  // Dim warm-brown surface (matches the bitcoin/red light variants) and
  // a brighter ink so the warning copy stays readable on a dark sheet.
  zapYellowLight: '#3A2F10',
  zapYellowDark: '#FFD566',
  // Match the light-palette map accents — purple reads well on both
  // themes so no adjustment needed.
  cachePurple: '#7A5CFF',
  eventViolet: '#5B3AFF',
  // Same brand violet in both themes — reads well on light and dark.
  brandPurple: '#9B40FF',
};

export type Palette = typeof lightPalette;
export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedScheme = 'light' | 'dark';
