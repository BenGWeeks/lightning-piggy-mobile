import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/**
 * Shared presentation for the Geo-caches community sections — the
 * "Recently added" rail, the "Recently found" feed, and the hider /
 * finder leaderboards. One factory keeps the four sub-components visually
 * consistent (same card radius, avatar size, section-header rhythm) and
 * matches the surrounding `HuntScreen` rows.
 */
export const createHuntCommunityStyles = (colors: Palette) =>
  StyleSheet.create({
    // Section scaffolding ---------------------------------------------------
    section: { marginBottom: 6 },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 16,
      marginTop: 18,
      marginBottom: 10,
    },
    sectionTitle: {
      flex: 1,
      fontSize: 15,
      fontWeight: '800',
      color: colors.textHeader,
    },
    sectionCount: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSupplementary,
    },
    emptyText: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginHorizontal: 16,
      marginBottom: 6,
      lineHeight: 19,
    },

    // Recently-added horizontal rail ---------------------------------------
    rail: { paddingHorizontal: 16, gap: 10 },
    railCard: {
      width: 150,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 10,
    },
    // Anchors the absolutely-positioned LpPayoutBadge to the thumb area.
    railThumbWrap: { position: 'relative' },
    railThumb: {
      width: '100%',
      height: 84,
      borderRadius: 8,
      backgroundColor: colors.divider,
      marginBottom: 8,
    },
    railIconWrap: {
      width: '100%',
      height: 84,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
    },
    railIconLp: { backgroundColor: colors.brandPink },
    railIconStandard: { backgroundColor: '#7A5CFF' },
    railTitle: { fontSize: 14, fontWeight: '700', color: colors.textHeader },
    railMeta: { fontSize: 11, color: colors.textSupplementary, marginTop: 2 },

    // Avatar (shared by leaderboard rows) ----------------------------------
    avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.divider },
    avatarFallback: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.brandPinkLight,
    },

    // Recently-found horizontal rail cards ---------------------------------
    findCard: {
      width: 140,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 10,
    },
    findCardAvatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.divider,
      marginBottom: 8,
    },
    findCardAvatarFallback: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.brandPinkLight,
    },
    findCardName: { fontSize: 13, fontWeight: '700', color: colors.textHeader },
    findCardCache: { fontSize: 11, color: colors.textSupplementary, marginTop: 2, lineHeight: 15 },
    findCardFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 6,
      flexWrap: 'wrap',
    },
    findCardAmountPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
      backgroundColor: colors.brandPinkLight,
    },
    findCardAmountText: { fontSize: 10, fontWeight: '800', color: colors.brandPink },
    findCardAge: { fontSize: 10, color: colors.textSupplementary, flex: 1 },
    skeletonFindCard: {
      width: 140,
      height: 120,
      borderRadius: 12,
      backgroundColor: colors.surface,
    },

    // Row styles (kept for backward compat if used elsewhere) --------------
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.surface,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      marginHorizontal: 16,
      marginBottom: 8,
    },
    rowMain: { flex: 1 },
    rowName: { fontSize: 14, fontWeight: '700', color: colors.textHeader },
    rowMeta: { fontSize: 12, color: colors.textSupplementary, marginTop: 2 },
    amountPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 8,
      backgroundColor: colors.brandPinkLight,
    },
    amountPillText: { fontSize: 12, fontWeight: '800', color: colors.brandPink },

    // Friends filter toggle -------------------------------------------------
    toggleRow: { flexDirection: 'row', gap: 8, marginHorizontal: 16, marginBottom: 10 },
    toggleButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 100,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    toggleButtonActive: { backgroundColor: colors.brandPink, borderColor: colors.brandPink },
    toggleText: { fontSize: 12, fontWeight: '700', color: colors.textSupplementary },
    toggleTextActive: { color: colors.white },

    // Leaderboard rows ------------------------------------------------------
    leaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.surface,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      marginHorizontal: 16,
      marginBottom: 8,
    },
    rankBadge: { width: 24, alignItems: 'center', justifyContent: 'center' },
    rankText: { fontSize: 14, fontWeight: '800', color: colors.textSupplementary },
    countPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 100,
      backgroundColor: colors.background,
    },
    countPillValue: { fontSize: 14, fontWeight: '800', color: colors.textHeader },
    countPillPiglet: { fontSize: 11, fontWeight: '700', color: colors.brandPink },

    // Loading skeletons -----------------------------------------------------
    skeletonRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginHorizontal: 16,
      marginBottom: 8,
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      borderRadius: 12,
    },
    skeletonCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.divider },
    skeletonLineWide: {
      width: '55%',
      height: 12,
      borderRadius: 6,
      backgroundColor: colors.divider,
    },
    skeletonLineNarrow: {
      width: '30%',
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.divider,
      marginTop: 6,
    },
    skeletonRailCard: {
      width: 150,
      height: 130,
      borderRadius: 12,
      backgroundColor: colors.surface,
    },
  });

export type HuntCommunityStyles = ReturnType<typeof createHuntCommunityStyles>;
