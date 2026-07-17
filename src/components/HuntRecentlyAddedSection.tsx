import React from 'react';
import { View, Text, FlatList } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import HuntRailCard from './HuntRailCard';
import type { ParsedCache } from '../services/nostrPlacesService';
import { createHuntCommunityStyles } from '../styles/HuntCommunity.styles';

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
            <HuntRailCard
              cache={item}
              pos={pos}
              styles={styles}
              onPress={() => onPressCache(item.coord)}
              testID={`hunt-recently-added-card-${index}`}
            />
          )}
        />
      )}
    </View>
  );
};

export default HuntRecentlyAddedSection;
