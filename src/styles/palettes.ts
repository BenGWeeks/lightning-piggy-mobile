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
  courseTeal: '#109AB8',
  bitcoinOrange: '#F7931A',
  bitcoinOrangeLight: '#FFF1E0',
  boltzNavy: '#232742',
  zapYellow: '#FFC107',
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
  courseTeal: '#2EB8D6',
  bitcoinOrange: '#F7931A',
  bitcoinOrangeLight: '#3A2410',
  boltzNavy: '#3A3F5C',
  zapYellow: '#FFC107',
};

export type Palette = typeof lightPalette;
export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedScheme = 'light' | 'dark';
