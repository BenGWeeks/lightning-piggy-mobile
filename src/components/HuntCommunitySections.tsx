import React from 'react';
import { View } from 'react-native';
import { useHuntCommunity } from '../hooks/useHuntCommunity';
import HuntRecentlyAddedSection from './HuntRecentlyAddedSection';
import HuntRecentFindsSection from './HuntRecentFindsSection';
import HuntLeaderboard from './HuntLeaderboard';

interface Props {
  /** Live user position for distance labels on the recently-added rail. */
  pos: { lat: number; lon: number } | null;
  /** Opens a cache's detail screen — owned by `HuntScreen`'s navigator. */
  onPressCache: (coord: string) => void;
}

/**
 * Composes the four Geo-caches community sections above the nearby list —
 * recently added, recently found (with friends filter), and the hider /
 * finder leaderboards. Owns the shared `useHuntCommunity` data hook (one
 * pair of relay subscriptions) and threads its slices into the individual
 * section components. Kept as its own module so `HuntScreen` stays a thin
 * composition and each section is independently reviewable.
 */
const HuntCommunitySections: React.FC<Props> = ({ pos, onPressCache }) => {
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
      <HuntLeaderboard variant="hiders" entries={hiderLeaderboard} loading={loading} />
      <HuntLeaderboard variant="finders" entries={finderLeaderboard} loading={loading} />
    </View>
  );
};

export default HuntCommunitySections;
