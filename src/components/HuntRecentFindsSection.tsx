import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { isSupportedImageUrl } from '../utils/imageUrl';
import { PartyPopper, PiggyBank, User, Users, Zap } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useNostr } from '../contexts/NostrContext';
import { useTrustGraph } from '../contexts/TrustGraphContext';
import { usePubkeyProfile } from '../hooks/usePubkeyProfile';
import { shortNpub } from '../utils/shortNpub';
import { sortRecentFinds } from '../utils/huntLeaderboard';
import type { ParsedCache, ParsedFoundLog } from '../services/nostrPlacesService';
import {
  createHuntCommunityStyles,
  type HuntCommunityStyles,
} from '../styles/HuntCommunity.styles';
interface Props {
  /** All found-logs (deduped by id), newest-first. Filtered + sliced here. */
  finds: ParsedFoundLog[];
  cacheByCoord: Map<string, ParsedCache>;
  loading: boolean;
  onPressCache: (coord: string) => void;
}

const FEED_LIMIT = 12;

/**
 * "Recently found" — a horizontal rail of the latest cache claims across
 * the network, with an All ⟷ Friends toggle. "Friends" reuses the app's
 * web-of-trust set (kind-3 follows + seeds, minus the signed-in user) —
 * the same source `MyPiglets` uses for its "Friends' finds" section —
 * filtered client-side so flipping the toggle re-ranks instantly with no
 * re-subscribe. Mirrors the horizontal layout of the "Recently added" rail
 * so the two sections form a consistent visual pair.
 */
const HuntRecentFindsSection: React.FC<Props> = ({
  finds,
  cacheByCoord,
  loading,
  onPressCache,
}) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createHuntCommunityStyles(colors), [colors]);
  const { pubkey } = useNostr();
  const { trustSet } = useTrustGraph();
  const [friendsOnly, setFriendsOnly] = useState(false);

  // Follows minus me, lowercased — trustSet includes the signed-in user
  // and seeds, so drop self to keep the filter to genuine friends' finds.
  const friendAuthors = useMemo(() => {
    const lower = pubkey?.toLowerCase();
    const s = new Set<string>();
    for (const p of trustSet) {
      const l = p.toLowerCase();
      if (l !== lower) s.add(l);
    }
    return s;
  }, [trustSet, pubkey]);

  const visibleFinds = useMemo(
    () =>
      sortRecentFinds(finds, {
        limit: FEED_LIMIT,
        authors: friendsOnly ? friendAuthors : undefined,
      }),
    [finds, friendsOnly, friendAuthors],
  );

  return (
    <View style={styles.section} testID="hunt-recent-finds">
      <View style={styles.sectionHeader}>
        <PartyPopper size={18} color={colors.brandPink} strokeWidth={2.5} />
        <Text style={styles.sectionTitle}>{t('huntCommunity.recentlyFound')}</Text>
      </View>

      <View style={styles.toggleRow}>
        <ToggleButton
          label={t('huntCommunity.filterAll')}
          active={!friendsOnly}
          onPress={() => setFriendsOnly(false)}
          styles={styles}
          testID="hunt-recent-finds-filter-all"
        />
        <ToggleButton
          label={t('huntCommunity.filterFriends')}
          active={friendsOnly}
          onPress={() => setFriendsOnly(true)}
          styles={styles}
          testID="hunt-recent-finds-filter-friends"
          icon={
            <Users
              size={13}
              color={friendsOnly ? colors.white : colors.textSupplementary}
              strokeWidth={2.5}
            />
          }
        />
      </View>

      {loading && finds.length === 0 ? (
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={[0, 1, 2]}
          keyExtractor={(i) => `sfk-${i}`}
          contentContainerStyle={styles.rail}
          renderItem={() => <View style={styles.skeletonFindCard} accessibilityElementsHidden />}
        />
      ) : visibleFinds.length === 0 ? (
        <Text style={styles.emptyText} testID="hunt-recent-finds-empty">
          {friendsOnly
            ? t('huntCommunity.emptyFriendsFinds')
            : t('huntCommunity.emptyRecentlyFound')}
        </Text>
      ) : (
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={visibleFinds}
          keyExtractor={(f) => f.id}
          contentContainerStyle={styles.rail}
          renderItem={({ item, index }) => (
            <FindCard
              find={item}
              cache={cacheByCoord.get(item.coord) ?? null}
              index={index}
              styles={styles}
              onPress={() => item.coord && onPressCache(item.coord)}
            />
          )}
        />
      )}
    </View>
  );
};

const ToggleButton: React.FC<{
  label: string;
  active: boolean;
  onPress: () => void;
  styles: HuntCommunityStyles;
  testID: string;
  icon?: React.ReactNode;
}> = ({ label, active, onPress, styles, testID, icon }) => (
  <TouchableOpacity
    style={[styles.toggleButton, active && styles.toggleButtonActive]}
    onPress={onPress}
    testID={testID}
    accessibilityRole="button"
    accessibilityState={{ selected: active }}
    accessibilityLabel={label}
  >
    {icon}
    <Text style={[styles.toggleText, active && styles.toggleTextActive]}>{label}</Text>
  </TouchableOpacity>
);

const FindCard: React.FC<{
  find: ParsedFoundLog;
  cache: ParsedCache | null;
  index: number;
  styles: HuntCommunityStyles;
  onPress: () => void;
}> = ({ find, cache, index, styles, onPress }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const { name, picture } = usePubkeyProfile(find.finderPubkey);
  const display = name ?? shortNpub(find.finderPubkey);
  const cacheName = cache?.name ?? t('huntCommunity.aGeoCache');
  const ageMins = Math.max(0, Math.floor((Date.now() / 1000 - find.createdAt) / 60));
  const ageLabel =
    ageMins < 60
      ? t('huntCommunity.ageMinutes', { count: ageMins })
      : ageMins < 60 * 24
        ? t('huntCommunity.ageHours', { count: Math.floor(ageMins / 60) })
        : t('huntCommunity.ageDays', { count: Math.floor(ageMins / (60 * 24)) });

  // Mirror ContactListItem / ConversationRow: track decode errors per URL so
  // a supported URL that fails at runtime falls back to the placeholder icon.
  // Reset on URL change so a card reused for a different finder doesn't
  // permanently display the error-fallback from the previous pubkey.
  const [avatarError, setAvatarError] = useState(false);
  useEffect(() => {
    setAvatarError(false);
  }, [picture]);
  const showAvatar = !!picture && !avatarError && isSupportedImageUrl(picture);

  return (
    <TouchableOpacity
      style={styles.findCard}
      onPress={onPress}
      testID={`hunt-recent-finds-card-${index}`}
      accessibilityLabel={t('huntCommunity.findRowA11y', { name: display, cache: cacheName })}
    >
      {showAvatar ? (
        <Image
          source={{ uri: picture }}
          style={styles.findCardAvatar}
          cachePolicy="memory-disk"
          recyclingKey={picture}
          autoplay={false}
          onError={() => setAvatarError(true)}
        />
      ) : (
        <View style={[styles.findCardAvatar, styles.findCardAvatarFallback]}>
          <User size={22} color={colors.brandPink} strokeWidth={2.5} />
        </View>
      )}
      <Text style={styles.findCardName} numberOfLines={1}>
        {display}
      </Text>
      <Text style={styles.findCardCache} numberOfLines={2}>
        {cacheName}
      </Text>
      <View style={styles.findCardFooter}>
        {cache?.isLpPiggy ? (
          <PiggyBank size={12} color={colors.brandPink} strokeWidth={2.5} />
        ) : null}
        {find.amountSats != null ? (
          <View style={styles.findCardAmountPill}>
            <Zap size={10} color={colors.brandPink} fill={colors.brandPink} strokeWidth={2.5} />
            <Text style={styles.findCardAmountText}>{find.amountSats.toLocaleString()}</Text>
          </View>
        ) : null}
        <Text style={styles.findCardAge} numberOfLines={1}>
          {ageLabel}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

export default HuntRecentFindsSection;
