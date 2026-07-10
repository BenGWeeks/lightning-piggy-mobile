import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ChevronRight, Trophy } from 'lucide-react-native';
import { useHuntCommunity } from '../hooks/useHuntCommunity';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import HuntRecentlyAddedSection from './HuntRecentlyAddedSection';
import HuntRecentFindsSection from './HuntRecentFindsSection';
import type { ExploreNavigation } from '../navigation/types';
import type { Palette } from '../styles/palettes';

interface Props {
  /** Live user position for distance labels on the recently-added rail. */
  pos: { lat: number; lon: number } | null;
  /** Opens a cache's detail screen — owned by `HuntScreen`'s navigator. */
  onPressCache: (coord: string) => void;
  /** Navigator for pushing the full leaderboard page. */
  navigation: ExploreNavigation;
}

/**
 * Composes the Geo-caches community sections above the nearby list —
 * recently added rail, recently found rail (with friends filter), and a
 * "Leaderboard" link row that pushes `HuntLeaderboardScreen` for the full
 * hider / finder boards. Owns the shared `useHuntCommunity` data hook (one
 * pair of relay subscriptions) and threads its slices into the individual
 * section components. Kept as its own module so `HuntScreen` stays a thin
 * composition and each section is independently reviewable.
 */
const HuntCommunitySections: React.FC<Props> = ({ pos, onPressCache, navigation }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { recentCaches, finds, cacheByCoord, hiderLeaderboard, finderLeaderboard, loading } =
    useHuntCommunity();

  return (
    <View testID="hunt-community-sections">
      <HuntRecentlyAddedSection
        caches={recentCaches}
        loading={loading}
        pos={pos}
        onPressCache={onPressCache}
      />
      <HuntRecentFindsSection
        finds={finds}
        cacheByCoord={cacheByCoord}
        loading={loading}
        onPressCache={onPressCache}
      />
      {/* Leaderboard entry point — full boards live on HuntLeaderboardScreen
          so the main hunt list stays uncluttered. */}
      <TouchableOpacity
        style={styles.leaderboardLink}
        onPress={() =>
          navigation.navigate('HuntLeaderboard', {
            hiderLeaderboard,
            finderLeaderboard,
            loading,
          })
        }
        testID="hunt-leaderboard-link"
        accessibilityLabel={t('huntCommunity.viewLeaderboard')}
      >
        <Trophy size={18} color={colors.brandPink} strokeWidth={2.5} />
        <Text style={styles.leaderboardLinkText}>{t('huntCommunity.viewLeaderboard')}</Text>
        <ChevronRight size={18} color={colors.textSupplementary} strokeWidth={2.5} />
      </TouchableOpacity>
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    leaderboardLink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.surface,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginHorizontal: 16,
      marginTop: 18,
      marginBottom: 6,
    },
    leaderboardLinkText: {
      flex: 1,
      fontSize: 15,
      fontWeight: '700',
      color: colors.textHeader,
    },
  });

export default HuntCommunitySections;
