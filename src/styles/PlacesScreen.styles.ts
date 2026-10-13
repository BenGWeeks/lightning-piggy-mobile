import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';
export const createPlacesScreenStyles = (colors: Palette) =>
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
    // Match HuntScreen's rounded-pill search row so the two Explore
    // sub-screens look like siblings rather than cousins. Same gap,
    // padding, and borderRadius 100 for the pill. Skips
    // marginHorizontal: 16 because the FlatList's listContent already
    // applies 16 dp padding here — adding margin on top double-insets
    // the search so it ends up narrower than the map + row cards.
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
      backgroundColor: colors.surface,
      borderRadius: 100,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    attributionRow: {
      // Cancel the `listContent` 16px padding then re-apply 16px so the
      // chip's right edge lines up with the map's right edge (the map
      // sits at a true 16dp inset — see `miniMapContainer`).
      marginHorizontal: -16,
      paddingHorizontal: 16,
      // Negative top margin pulls the chip up into the small gap below
      // the map so it visually sits glued to the map's bottom edge.
      // Bottom padding keeps breathing room before the search row.
      marginTop: -4,
      paddingTop: 0,
      paddingBottom: 12,
      alignItems: 'flex-end',
    },
    miniMapContainer: {
      // `listContent` applies `padding: 16`, and `ExploreMiniMap` already
      // carries its own `marginHorizontal: 16`. Without cancelling the
      // list padding the map ends up double-inset (~32dp) and visibly
      // narrower than the Geo-caches map (which only gets the 16dp).
      // Negative horizontal margin cancels the list padding so the map
      // lands at a true 16dp inset, consistent across the Explore stack.
      marginHorizontal: -16,
      // No extra paddingTop — `listContent`'s own `padding: 16` already
      // gives the 16dp header-to-map gap shared across Explore / Places
      // / Geo-caches. The old `paddingTop: 12` stacked on top of that
      // (28dp total) and made this screen's gap inconsistent.
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
      color: colors.textHeader,
      paddingVertical: 4,
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
    subtle: { fontSize: 14, color: colors.textSupplementary, textAlign: 'center', lineHeight: 20 },
    emptyTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.textHeader,
      marginTop: 6,
      textAlign: 'center',
    },
    emptySearchText: {
      fontSize: 13,
      color: colors.textSupplementary,
      textAlign: 'center',
      padding: 24,
    },
    errorText: { fontSize: 14, color: colors.brandPink, textAlign: 'center', lineHeight: 20 },
    retryButton: {
      backgroundColor: colors.brandPink,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 100,
      marginTop: 8,
    },
    retryButtonText: { color: colors.white, fontWeight: '700', fontSize: 14 },
    // Tighter gap between row cards (10 → 6) so PlacesScreen feels as
    // dense as HuntScreen's Geo-caches list — Ben asked the two
    // Explore sub-screens to read as siblings.
    listContent: { padding: 16, gap: 6 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.surface,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 10,
    },
    rowBoosted: {
      // 1px zap-yellow border + a hint of fill so a boosted row stands
      // apart from the surface stack without screaming.
      borderWidth: 1,
      borderColor: colors.zapYellow,
    },
    iconWrap: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconLightning: { backgroundColor: colors.brandPink },
    iconOnchain: { backgroundColor: '#F7931A' },
    rowMain: { flex: 1 },
    rowTitleLine: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    rowTitle: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: colors.textHeader },
    rowFeaturedPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: colors.zapYellow,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 999,
    },
    rowFeaturedText: { fontSize: 10, fontWeight: '800', color: colors.textHeader },
    rowMeta: { fontSize: 12, color: colors.textSupplementary, marginTop: 2 },
    rowSub: { fontSize: 12, color: colors.textSupplementary, marginTop: 2, fontStyle: 'italic' },
    rowLink: {
      fontSize: 12,
      color: colors.brandPink,
      marginTop: 2,
      fontStyle: 'italic',
      textDecorationLine: 'underline',
    },
    filterIconButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 8,
    },
    filterIconBadge: {
      position: 'absolute',
      top: -2,
      right: -2,
      minWidth: 16,
      height: 16,
      paddingHorizontal: 4,
      borderRadius: 8,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    filterIconBadgeText: {
      color: colors.white,
      fontSize: 10,
      fontWeight: '800',
    },
  });
