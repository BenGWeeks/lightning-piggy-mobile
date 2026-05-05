import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createLearnScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    headerBackground: {
      // 140 px is the pre-#139 design height that lets the decorative
      // background image breathe. We use `minHeight` (not a fixed `height`)
      // so the box grows to fit the new search row added in #151 without
      // clipping it. When the search input is collapsed the box stays at
      // 140 px; when expanded the extra row pushes it just below.
      minHeight: 140,
      paddingBottom: 8,
      backgroundColor: colors.brandPink,
      overflow: 'hidden',
    },
    headerImage: {
      ...StyleSheet.absoluteFillObject,
    },
    headerOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(236, 0, 140, 0.65)', // brandPink with 65% opacity
    },
    // Sits below the TabHeader title row, inside the pink header band.
    // Mirrors the Messages/Friends `headerExtras` + `chipRow` pattern so the
    // search affordance reads consistently across the four top-level tabs.
    headerExtras: {
      paddingHorizontal: 20,
      paddingTop: 4,
    },
    searchRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(255,255,255,0.2)',
      borderRadius: 20,
      paddingHorizontal: 12,
      gap: 8,
    },
    searchInput: {
      flex: 1,
      paddingVertical: 8,
      fontSize: 15,
      color: colors.white,
      fontWeight: '500',
    },
    searchToggleRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
    },
    searchToggle: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(255,255,255,0.2)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    scrollArea: {
      flex: 1,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      padding: 16,
      gap: 16,
    },
    courseCard: {
      width: '47%',
      backgroundColor: colors.surface,
      borderRadius: 12,
      overflow: 'hidden',
      paddingBottom: 14,
    },
    chipSpacer: {
      flex: 1,
    },
    imageWrapper: {
      width: '100%',
      height: 130,
      position: 'relative',
    },
    courseImage: {
      width: '100%',
      height: '100%',
    },
    completeBadge: {
      position: 'absolute',
      top: 8,
      right: 8,
      backgroundColor: colors.green,
      width: 28,
      height: 28,
      borderRadius: 14,
      justifyContent: 'center',
      alignItems: 'center',
    },
    completeBadgeText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
    courseTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textHeader,
      paddingHorizontal: 12,
      paddingTop: 10,
    },
    courseMeta: {
      fontSize: 12,
      color: colors.textSupplementary,
      paddingHorizontal: 12,
      paddingTop: 2,
      paddingBottom: 8,
    },
    chipNew: {
      marginHorizontal: 12,
      backgroundColor: colors.brandPink,
      paddingHorizontal: 14,
      height: 26,
      justifyContent: 'center',
      borderRadius: 100,
      alignSelf: 'flex-start',
    },
    chipNewText: {
      color: colors.white,
      fontSize: 11,
      fontWeight: '700',
    },
    chipProgress: {
      marginHorizontal: 12,
      backgroundColor: colors.brandPinkLight,
      paddingHorizontal: 14,
      height: 26,
      justifyContent: 'center',
      borderRadius: 100,
      alignSelf: 'flex-start',
    },
    chipProgressText: {
      color: colors.brandPink,
      fontSize: 11,
      fontWeight: '700',
    },
    chipEarned: {
      marginHorizontal: 12,
      backgroundColor: colors.greenLight,
      paddingHorizontal: 14,
      height: 26,
      justifyContent: 'center',
      borderRadius: 100,
      alignSelf: 'flex-start',
    },
    chipEarnedText: {
      color: colors.greenDark,
      fontSize: 11,
      fontWeight: '700',
    },
    emptyState: {
      width: '100%',
      padding: 40,
      alignItems: 'center',
      gap: 8,
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
      textAlign: 'center',
    },
    emptySubtitle: {
      fontSize: 14,
      color: colors.textSupplementary,
      textAlign: 'center',
    },
    clearSearchButton: {
      marginTop: 12,
      backgroundColor: colors.brandPink,
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: 100,
    },
    clearSearchButtonText: {
      color: colors.white,
      fontSize: 13,
      fontWeight: '700',
    },
  });
