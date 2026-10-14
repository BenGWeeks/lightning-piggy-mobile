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
    headerTagline: {
      marginTop: 10,
      paddingHorizontal: 4,
      color: 'rgba(255,255,255,0.85)',
      fontSize: 13,
      fontWeight: '500',
    },
    // The active seller-scope pill, just under the search row.
    scopeRow: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8, alignItems: 'flex-start' },
    scopeChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.brandPink,
      backgroundColor: colors.surface,
    },
    scopeChipText: { fontSize: 12, fontWeight: '600', color: colors.brandPink },
    // ----- inline search + filter button -----------------------------------
    // A single compact row: the search pill (flex) plus a square filter icon
    // button. Replaces the old three always-visible chip rows so the grid
    // starts higher.
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 4,
      backgroundColor: colors.background,
    },
    searchRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      height: 40,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
      color: colors.textBody,
      // Strip the default vertical padding so the text centres in the pill.
      paddingVertical: 0,
    },
    filterButton: {
      width: 40,
      height: 40,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    filterButtonActive: {
      backgroundColor: colors.brandPink,
      borderColor: colors.brandPink,
    },
    // Count badge pinned to the button's top-right corner when filters apply.
    filterBadge: {
      position: 'absolute',
      top: -4,
      right: -4,
      minWidth: 18,
      height: 18,
      paddingHorizontal: 4,
      borderRadius: 999,
      backgroundColor: colors.brandPink,
      borderWidth: 2,
      borderColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    filterBadgeText: {
      fontSize: 10,
      fontWeight: '800',
      color: colors.white,
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
    // Shown only when a load missed some sellers — never a permanent row.
    partialBanner: {
      marginHorizontal: 16,
      marginTop: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: colors.surface,
    },
    partialBannerText: { fontSize: 12, color: colors.textSupplementary },
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
