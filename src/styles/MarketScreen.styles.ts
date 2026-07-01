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
    // Mode-selector bar sitting just under the header — the chip row plus a
    // small caption naming the active mode.
    modeBar: {
      paddingTop: 10,
      paddingBottom: 4,
      gap: 2,
      backgroundColor: colors.background,
    },
    modeCaption: {
      paddingHorizontal: 16,
      fontSize: 11,
      fontWeight: '600',
      color: colors.textSupplementary,
    },
    // ----- product grid ----------------------------------------------------
    // Outer padding matches MARKET_GRID_PADDING (16); the tile width is
    // derived to fill the row inside it. Row gutter comes from gridRow's
    // marginBottom, the column gutter from justify-between spacing.
    gridContent: {
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 32,
    },
    // Each grid row: tiles pushed to the outer edges with the gutter between
    // (MARKET_GRID_GAP is baked into the derived tile width). A lone last tile
    // stays left-aligned at column width rather than stretching.
    gridRow: {
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    emptyWrap: {
      paddingVertical: 48,
      paddingHorizontal: 24,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 13,
      color: colors.textSupplementary,
      textAlign: 'center',
      lineHeight: 19,
    },
  });
