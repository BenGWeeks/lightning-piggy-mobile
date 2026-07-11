import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import HuntLeaderboard from '../components/HuntLeaderboard';
import BrandPatternBackground from '../components/BrandPatternBackground';
import { createHuntLeaderboardScreenStyles } from '../styles/HuntLeaderboardScreen.styles';
import type { ExploreNavigation, HuntLeaderboardRoute } from '../navigation/types';

interface Props {
  navigation: ExploreNavigation;
  route: HuntLeaderboardRoute;
}

type LeaderboardTab = 'hiders' | 'finders';

/**
 * Full-page Geo-caches leaderboard — segmented tabs switch between
 * Top Hiders (by distinct caches authored) and Top Finders (by distinct
 * caches claimed), derived from the same `useHuntCommunity` data hook
 * as the community rail sections.  Accessible via the "Leaderboard" link
 * in HuntCommunitySections.
 *
 * Data arrives via route params rather than a second `useHuntCommunity()`
 * call: HuntScreen's instance (via HuntCommunitySections) already owns the
 * subscribeRecentCaches / subscribeRecentFoundLogs subscription pair, so
 * opening a second instance here would duplicate ~400 relay events through
 * the JS thread (#1028). Switching tabs reads from the same frozen params —
 * no re-fetch, no new subscriptions (#1041).
 *
 * The leaderboard arrays are plain-serialisable (pubkey/total/pigletCount
 * strings and numbers) so they travel safely through navigation state.
 */
const HuntLeaderboardScreen: React.FC<Props> = ({ navigation, route }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createHuntLeaderboardScreenStyles(colors), [colors]);

  // Guard against restored navigation state from before params were added
  // (#1028). A cold-start restore of a stale HuntLeaderboard entry (which
  // previously took no params) would arrive here with route.params undefined.
  // Fall back to empty boards so the screen renders the empty-state text
  // rather than crashing on destructuring.
  const { hiderLeaderboard = [], finderLeaderboard = [], loading = false } = route.params ?? {};

  // "Top hiders" is the default tab — mirrors the order used on the website.
  const [activeTab, setActiveTab] = useState<LeaderboardTab>('hiders');

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

      {/* Segmented chip tabs — same pink-active / outlined-inactive pattern
          as the All ⟷ Friends toggle in HuntRecentFindsSection. */}
      <View style={styles.tabRow} accessibilityRole="tablist">
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'hiders' && styles.tabButtonActive]}
          onPress={() => setActiveTab('hiders')}
          testID="leaderboard-tab-hiders"
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'hiders' }}
          accessibilityLabel={t('huntLeaderboard.tabHiders')}
        >
          <Text style={[styles.tabText, activeTab === 'hiders' && styles.tabTextActive]}>
            {t('huntLeaderboard.tabHiders')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'finders' && styles.tabButtonActive]}
          onPress={() => setActiveTab('finders')}
          testID="leaderboard-tab-finders"
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'finders' }}
          accessibilityLabel={t('huntLeaderboard.tabFinders')}
        >
          <Text style={[styles.tabText, activeTab === 'finders' && styles.tabTextActive]}>
            {t('huntLeaderboard.tabFinders')}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        testID="hunt-leaderboard-scroll"
      >
        {activeTab === 'hiders' ? (
          <HuntLeaderboard variant="hiders" entries={hiderLeaderboard} loading={loading} />
        ) : (
          <HuntLeaderboard variant="finders" entries={finderLeaderboard} loading={loading} />
        )}
      </ScrollView>
    </View>
  );
};

export default HuntLeaderboardScreen;
