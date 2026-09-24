import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/**
 * Styles for {@link VendorAvatar} — the small circular merchant avatar on
 * Market product rows. Size-dependent bits (width/height/radius, the
 * fallback initial's font size) stay inline at the call site; everything
 * palette- or layout-driven lives here.
 */
export const createVendorAvatarStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      overflow: 'hidden',
      borderWidth: 1.5,
      borderColor: colors.surface,
      backgroundColor: 'rgba(127,127,127,0.12)',
    },
    fallback: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.brandPinkLight,
    },
    fallbackText: {
      fontWeight: '800',
      color: colors.brandPink,
    },
  });

export type VendorAvatarStyles = ReturnType<typeof createVendorAvatarStyles>;
