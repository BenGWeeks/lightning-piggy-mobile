import React from 'react';
import { View, Text, Image, TouchableOpacity, FlatList } from 'react-native';
import { MapPin, PiggyBank, Sparkles } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { formatDistance, decodeGeohash, haversineMetres } from '../utils/geohash';
import type { ParsedCache } from '../services/nostrPlacesService';
import {
  createHuntCommunityStyles,
  type HuntCommunityStyles,
} from '../styles/HuntCommunity.styles';

interface Props {
  caches: ParsedCache[];
  loading: boolean;
  /** Live user position, so a card can show distance when known. */
  pos: { lat: number; lon: number } | null;
  onPressCache: (coord: string) => void;
}

/**
 * "Recently added" — a horizontal rail of the most-recently-published
 * geo-caches (ordered by event `created_at`, NOT distance). Complements
 * the distance-sorted nearby list below it so a newcomer sees fresh
 * activity even if nothing is close by. Horizontal list nested in the
 * screen's vertical FlatList is fine (no VirtualizedList nesting warning).
 */
const HuntRecentlyAddedSection: React.FC<Props> = ({ caches, loading, pos, onPressCache }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = React.useMemo(() => createHuntCommunityStyles(colors), [colors]);

  return (
    <View style={styles.section} testID="hunt-recently-added">
      <View style={styles.sectionHeader}>
        <Sparkles size={18} color={colors.brandPink} strokeWidth={2.5} />
        <Text style={styles.sectionTitle}>{t('huntCommunity.recentlyAdded')}</Text>
      </View>
      {loading && caches.length === 0 ? (
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={[0, 1, 2]}
          keyExtractor={(i) => `sk-${i}`}
          contentContainerStyle={styles.rail}
          renderItem={() => <View style={styles.skeletonRailCard} accessibilityElementsHidden />}
        />
      ) : caches.length === 0 ? (
        <Text style={styles.emptyText} testID="hunt-recently-added-empty">
          {t('huntCommunity.emptyRecentlyAdded')}
        </Text>
      ) : (
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={caches}
          keyExtractor={(c) => c.coord}
          contentContainerStyle={styles.rail}
          renderItem={({ item, index }) => (
            <RailCard
              cache={item}
              index={index}
              pos={pos}
              styles={styles}
              onPress={() => onPressCache(item.coord)}
            />
          )}
        />
      )}
    </View>
  );
};

const RailCard: React.FC<{
  cache: ParsedCache;
  index: number;
  pos: { lat: number; lon: number } | null;
  styles: HuntCommunityStyles;
  onPress: () => void;
}> = ({ cache, index, pos, styles, onPress }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const center = cache.geohash ? decodeGeohash(cache.geohash) : null;
  const distance =
    pos && center
      ? haversineMetres({ lat: pos.lat, lon: pos.lon }, { lat: center.lat, lon: center.lng })
      : null;
  return (
    <TouchableOpacity
      style={styles.railCard}
      onPress={onPress}
      testID={`hunt-recently-added-card-${index}`}
      accessibilityLabel={cache.name}
    >
      {cache.imageUrl ? (
        <Image source={{ uri: cache.imageUrl }} style={styles.railThumb} resizeMode="cover" />
      ) : (
        <View
          style={[
            styles.railIconWrap,
            cache.isLpPiggy ? styles.railIconLp : styles.railIconStandard,
          ]}
        >
          {cache.isLpPiggy ? (
            <PiggyBank size={30} color={colors.white} strokeWidth={2} />
          ) : (
            <MapPin size={30} color={colors.white} strokeWidth={2} />
          )}
        </View>
      )}
      <Text style={styles.railTitle} numberOfLines={1}>
        {cache.name}
      </Text>
      <Text style={styles.railMeta} numberOfLines={1}>
        {cache.isLpPiggy ? t('huntScreen.piglet') : t('huntScreen.nipGcCache')}
        {distance != null ? ` · ${formatDistance(distance)}` : ''}
      </Text>
    </TouchableOpacity>
  );
};

export default HuntRecentlyAddedSection;
