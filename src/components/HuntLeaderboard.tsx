import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { isSupportedImageUrl } from '../utils/imageUrl';
import { Medal, PiggyBank, Trophy, User, Users } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { usePubkeyProfile } from '../hooks/usePubkeyProfile';
import { useOpenContactProfile } from '../hooks/useOpenContactProfile';
import { shortNpub } from '../utils/shortNpub';
import type { LeaderboardEntry } from '../utils/huntLeaderboard';
import {
  createHuntCommunityStyles,
  type HuntCommunityStyles,
} from '../styles/HuntCommunity.styles';

export type LeaderboardVariant = 'hiders' | 'finders';

// Gold / silver / bronze for the top-three rank badge. Off-palette by
// design — medal colours are a universal ranking convention, not brand
// colours, so they stay literal here rather than in the palette.
const MEDAL_COLORS = ['#F5B301', '#A8B0BD', '#CD7F32'];

interface Props {
  variant: LeaderboardVariant;
  entries: LeaderboardEntry[];
  loading: boolean;
}

/**
 * One leaderboard board — hiders (by distinct caches authored) or finders
 * (by distinct caches found). Semantics mirror the website `/leaderboard`
 * page (LightningPiggy/website#16): a piglet (`PiggyBank`) sub-badge
 * tallies the Lightning-Piggy subset (`pigletCount`). Rows resolve display
 * name + avatar through the
 * shared profile system and drill into the contact profile on tap.
 */
const HuntLeaderboard: React.FC<Props> = ({ variant, entries, loading }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = React.useMemo(() => createHuntCommunityStyles(colors), [colors]);
  const title = variant === 'hiders' ? t('huntCommunity.topHiders') : t('huntCommunity.topFinders');
  const testIdBase = variant === 'hiders' ? 'hunt-leaderboard-hiders' : 'hunt-leaderboard-finders';

  return (
    <View style={styles.section} testID={testIdBase}>
      <View style={styles.sectionHeader}>
        <Trophy size={18} color={colors.brandPink} strokeWidth={2.5} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {loading && entries.length === 0 ? (
        <SkeletonRows styles={styles} count={3} />
      ) : entries.length === 0 ? (
        <Text style={styles.emptyText} testID={`${testIdBase}-empty`}>
          {variant === 'hiders' ? t('huntCommunity.emptyHiders') : t('huntCommunity.emptyFinders')}
        </Text>
      ) : (
        entries.map((entry, index) => (
          <LeaderboardRow
            key={entry.pubkey}
            entry={entry}
            rank={index}
            variant={variant}
            styles={styles}
            testID={`${testIdBase}-row-${index}`}
          />
        ))
      )}
    </View>
  );
};

const LeaderboardRow: React.FC<{
  entry: LeaderboardEntry;
  rank: number;
  variant: LeaderboardVariant;
  styles: HuntCommunityStyles;
  testID: string;
}> = ({ entry, rank, variant, styles, testID }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const { name, picture, lud16 } = usePubkeyProfile(entry.pubkey);
  const openProfile = useOpenContactProfile();
  const display = name ?? shortNpub(entry.pubkey);
  const medalColor = rank < MEDAL_COLORS.length ? MEDAL_COLORS[rank] : null;

  return (
    <TouchableOpacity
      style={styles.leaderRow}
      testID={testID}
      accessibilityLabel={t(
        entry.total === 1 ? 'huntCommunity.leaderRowA11yOne' : 'huntCommunity.leaderRowA11y',
        { rank: rank + 1, name: display, count: entry.total },
      )}
      onPress={() => openProfile(entry.pubkey, name, picture, lud16)}
    >
      <View style={styles.rankBadge}>
        {medalColor ? (
          <Medal size={20} color={medalColor} strokeWidth={2.5} />
        ) : (
          <Text style={styles.rankText}>{rank + 1}</Text>
        )}
      </View>
      {picture && isSupportedImageUrl(picture) ? (
        <Image
          source={{ uri: picture }}
          style={styles.avatar}
          cachePolicy="memory-disk"
          recyclingKey={picture}
          autoplay={false}
        />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          {variant === 'finders' ? (
            <Users size={18} color={colors.brandPink} strokeWidth={2.5} />
          ) : (
            <User size={18} color={colors.brandPink} strokeWidth={2.5} />
          )}
        </View>
      )}
      <View style={styles.rowMain}>
        <Text style={styles.rowName} numberOfLines={1}>
          {display}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {variant === 'hiders'
            ? t(entry.total === 1 ? 'huntCommunity.cacheHiddenOne' : 'huntCommunity.cachesHidden', {
                count: entry.total,
              })
            : t(entry.total === 1 ? 'huntCommunity.cacheFoundOne' : 'huntCommunity.cachesFound', {
                count: entry.total,
              })}
        </Text>
      </View>
      <View style={styles.countPill}>
        <Text style={styles.countPillValue}>{entry.total}</Text>
        {entry.pigletCount > 0 ? (
          <>
            <PiggyBank size={12} color={colors.brandPink} strokeWidth={2.5} />
            <Text style={styles.countPillPiglet}>{entry.pigletCount}</Text>
          </>
        ) : null}
      </View>
    </TouchableOpacity>
  );
};

export const SkeletonRows: React.FC<{ styles: HuntCommunityStyles; count: number }> = ({
  styles,
  count,
}) => (
  <>
    {Array.from({ length: count }).map((_, i) => (
      <View key={i} style={styles.skeletonRow} accessibilityElementsHidden>
        <View style={styles.skeletonCircle} />
        <View style={{ flex: 1 }}>
          <View style={styles.skeletonLineWide} />
          <View style={styles.skeletonLineNarrow} />
        </View>
      </View>
    ))}
  </>
);

export default HuntLeaderboard;
