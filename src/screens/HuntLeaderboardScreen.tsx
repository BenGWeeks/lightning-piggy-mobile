import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import HuntLeaderboard from '../components/HuntLeaderboard';
import BrandPatternBackground from '../components/BrandPatternBackground';
import type { ExploreNavigation, HuntLeaderboardRoute } from '../navigation/types';
import type { Palette } from '../styles/palettes';

interface Props {
  navigation: ExploreNavigation;
  route: HuntLeaderboardRoute;
}

/**
 * Full-page Geo-caches leaderboard — Top Hiders (by distinct caches
 * authored) and Top Finders (by distinct caches claimed), derived from
 * the same `useHuntCommunity` data hook as the community rail sections.
 * Accessible via the "Leaderboard" link in HuntCommunitySections.
 *
 * Data arrives via route params rather than a second `useHuntCommunity()`
 * call: HuntScreen's instance (via HuntCommunitySections) already owns the
 * subscribeRecentCaches / subscribeRecentFoundLogs subscription pair, so
 * opening a second instance here would duplicate ~400 relay events through
 * the JS thread (#1028). The leaderboard arrays are plain-serialisable
 * (pubkey/total/pigletCount strings and numbers) so they travel safely
 * through navigation state.
 */
const HuntLeaderboardScreen: React.FC<Props> = ({ navigation, route }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { hiderLeaderboard, finderLeaderboard, loading } = route.params;

  return (
    <View style={styles.container} testID="hunt-leaderboard-screen">
      <View style={styles.header}>
        <BrandPatternBackground variant="explore-compass" />
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            accessibilityLabel={t('huntLeaderboard.backToGeoCaches')}
            testID="hunt-leaderboard-back-button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <ChevronLeft size={24} color={colors.white} strokeWidth={2.5} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('huntLeaderboard.title')}</Text>
          {/* Spacer to balance the back chevron */}
          <View style={styles.headerSpacer} />
        </View>
        <Text style={styles.headerTagline}>{t('huntLeaderboard.tagline')}</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        testID="hunt-leaderboard-scroll"
      >
        <HuntLeaderboard variant="hiders" entries={hiderLeaderboard} loading={loading} />
        <HuntLeaderboard variant="finders" entries={finderLeaderboard} loading={loading} />
      </ScrollView>
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
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
    scroll: { flex: 1 },
    scrollContent: { paddingBottom: 32 },
  });

export default HuntLeaderboardScreen;
