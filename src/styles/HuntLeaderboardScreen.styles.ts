import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/**
 * Styles for HuntLeaderboardScreen — the full-page leaderboard with a
 * segmented-chip tab row (Top hiders / Top finders) reusing the same
 * `toggleButton` / `toggleButtonActive` / `toggleText` / `toggleTextActive`
 * pattern as `HuntRecentFindsSection`'s All ⟷ Friends chips.
 */
export const createHuntLeaderboardScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },

    // Header ----------------------------------------------------------------
    header: {
      paddingHorizontal: 16,
      paddingTop: 48,
      paddingBottom: 14,
      backgroundColor: colors.brandPink,
      minHeight: 120,
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
    headerSpacer: { width: 24 },
    headerTagline: {
      marginTop: 10,
      paddingHorizontal: 4,
      color: 'rgba(255,255,255,0.85)',
      fontSize: 13,
      fontWeight: '500',
    },

    // Tab row (segmented chips) — mirrors HuntCommunity.styles toggleRow ------
    tabRow: {
      flexDirection: 'row',
      gap: 8,
      marginHorizontal: 16,
      marginTop: 14,
      marginBottom: 2,
    },
    tabButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 100,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    tabButtonActive: {
      backgroundColor: colors.brandPink,
      borderColor: colors.brandPink,
    },
    tabText: { fontSize: 13, fontWeight: '700', color: colors.textSupplementary },
    tabTextActive: { color: colors.white },

    // Scroll ----------------------------------------------------------------
    scroll: { flex: 1 },
    scrollContent: { paddingBottom: 32 },
  });

export type HuntLeaderboardScreenStyles = ReturnType<typeof createHuntLeaderboardScreenStyles>;
