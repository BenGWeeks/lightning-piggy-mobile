import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/** Styles for {@link MarketScreen}. Header mirrors PlacesScreen so the
 * Explore sub-screens read as siblings. */
export const createMarketScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingHorizontal: 16,
      paddingTop: 48,
      paddingBottom: 14,
      backgroundColor: colors.brandPink,
      minHeight: 140,
      overflow: 'hidden',
    },
    headerImage: {
      ...StyleSheet.absoluteFillObject,
    },
    headerOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(236, 0, 140, 0.65)',
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: 18,
      fontWeight: '700',
      color: colors.white,
    },
    // Spacer keeps the title centred against the lone back button on the
    // left (no right-hand action on this screen).
    headerSpacer: {
      width: 24,
    },
    headerTagline: {
      marginTop: 10,
      paddingHorizontal: 4,
      color: 'rgba(255,255,255,0.85)',
      fontSize: 13,
      fontWeight: '500',
    },
    listContent: {
      padding: 16,
      gap: 12,
      paddingBottom: 32,
    },
  });
