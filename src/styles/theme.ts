// Static colour constants for the light palette. New code should prefer
// `useThemeColors()` from '../contexts/ThemeContext' so that components
// respect the active light/dark/system preference. This export remains for
// non-component call sites (utils, constants, initial StyleSheet defaults)
// where accessing the React context isn't possible — those places will
// always render in the light palette.
import { lightPalette } from './palettes';

export const colors = lightPalette;

export type { Palette, ThemePreference, ResolvedScheme } from './palettes';
export { lightPalette, darkPalette } from './palettes';
