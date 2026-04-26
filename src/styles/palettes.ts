// Light and dark colour palettes. The key set must stay identical between the
// two objects so every `colors.X` lookup resolves in either theme. Add new
// entries to both palettes.
//
// `__DEV__` brand-pink swap: in dev builds the brand-pink + its light tint
// flip to a blue pair. Lets developers tell apart a dev / cloud / production
// install at a glance — the colour shift is visible everywhere brand-pink
// appears (app icon swap is per-build via `app.config.ts`, this handles
// every in-app surface that reads from the theme palette).

const DEV_BRAND_PINK = '#4A90D9';
const DEV_BRAND_PINK_LIGHT_LIGHT = '#E3F0FF';
const DEV_BRAND_PINK_LIGHT_DARK = '#0E2240';

export const lightPalette = {
  brandPink: __DEV__ ? DEV_BRAND_PINK : '#EC008C',
  brandPinkLight: __DEV__ ? DEV_BRAND_PINK_LIGHT_LIGHT : '#FFF0F5',
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
  brandPink: __DEV__ ? DEV_BRAND_PINK : '#EC008C',
  brandPinkLight: __DEV__ ? DEV_BRAND_PINK_LIGHT_DARK : '#3A1028',
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
