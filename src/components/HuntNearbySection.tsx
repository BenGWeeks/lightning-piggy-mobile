import React from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import { MapPin, PiggyBank, Search, SlidersHorizontal } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import HuntRailCard from './HuntRailCard';
import { createHuntCommunityStyles } from '../styles/HuntCommunity.styles';
import { createHuntNearbySectionStyles } from '../styles/HuntNearbySection.styles';
import type { ParsedCache } from '../services/nostrPlacesService';

interface Props {
  /** Distance-sorted, filter/search-applied nearby caches. */
  items: { cache: ParsedCache; distance: number }[];
  loading: boolean;
  /** Live user position, so cards can show distance when known. */
  pos: { lat: number; lon: number } | null;
  searchQuery: string;
  onChangeSearch: (query: string) => void;
  activeFilterCount: number;
  onOpenFilters: () => void;
  onPressCache: (coord: string) => void;
}

/**
 * "Nearby" — a horizontal rail of the distance-sorted caches around the
 * user, directly under the mini-map, with the search field + filter
 * button that scope it. Replaced the old full-width vertical list so the
 * page leads with the map and the community rails stay above the fold.
 *
 * The Maestro-facing testIDs from the vertical-list era are preserved:
 * `hunt-search-input`, `hunt-filter-button`, `hunt-discover-loading`,
 * `hunt-discover-empty-state`, `hunt-discover-row-<d>` and the
 * position-keyed `hunt-discover-row-<index>`.
 */
const HuntNearbySection: React.FC<Props> = ({
  items,
  loading,
  pos,
  searchQuery,
  onChangeSearch,
  activeFilterCount,
  onOpenFilters,
  onPressCache,
}) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const railStyles = React.useMemo(() => createHuntCommunityStyles(colors), [colors]);
  const styles = React.useMemo(() => createHuntNearbySectionStyles(colors), [colors]);

  return (
    <View style={railStyles.section} testID="hunt-nearby-section">
      <View style={railStyles.sectionHeader}>
        <MapPin size={18} color={colors.brandPink} strokeWidth={2.5} />
        <Text style={railStyles.sectionTitle}>{t('huntCommunity.nearby')}</Text>
      </View>
      <View style={styles.searchRow}>
        <Search size={16} color={colors.textSupplementary} strokeWidth={2.5} />
        <TextInput
          style={styles.searchInput}
          placeholder={t('huntScreen.searchPlaceholder')}
          placeholderTextColor={colors.textSupplementary}
          value={searchQuery}
          onChangeText={onChangeSearch}
          autoCapitalize="none"
          autoCorrect={false}
          testID="hunt-search-input"
        />
        <TouchableOpacity
          style={styles.filterIconButton}
          onPress={onOpenFilters}
          testID="hunt-filter-button"
          accessibilityLabel={
            activeFilterCount > 0
              ? t('huntScreen.filtersActive', { count: activeFilterCount })
              : t('huntScreen.filters')
          }
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <SlidersHorizontal size={18} color={colors.textHeader} strokeWidth={2.5} />
          {activeFilterCount > 0 ? (
            <View style={styles.filterIconBadge}>
              <Text style={styles.filterIconBadgeText}>{activeFilterCount}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
      </View>
      {loading && items.length === 0 ? (
        <View style={styles.center} testID="hunt-discover-loading">
          <ActivityIndicator color={colors.brandPink} />
          <Text style={styles.subtle}>{t('huntScreen.lookingForCaches')}</Text>
        </View>
      ) : items.length === 0 && searchQuery.trim() !== '' ? (
        <Text style={styles.emptySearchText}>
          {t('huntScreen.noMatch', { query: searchQuery.trim() })}
        </Text>
      ) : items.length === 0 ? (
        <View style={styles.center} testID="hunt-discover-empty-state">
          <PiggyBank size={56} color={colors.textSupplementary} strokeWidth={1.5} />
          <Text style={styles.emptyTitle}>{t('huntScreen.noCachesNearby')}</Text>
          <Text style={styles.subtle}>
            {t('huntScreen.emptyPrefix')}
            <Text style={styles.emptyBold}>+</Text>
            {t('huntScreen.emptySuffix')}
          </Text>
        </View>
      ) : (
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={items}
          keyExtractor={({ cache }) => cache.coord}
          contentContainerStyle={railStyles.rail}
          renderItem={({ item, index }) => (
            <HuntRailCard
              cache={item.cache}
              pos={pos}
              distanceMetres={item.distance}
              styles={railStyles}
              onPress={() => onPressCache(item.cache.coord)}
              testID={`hunt-discover-row-${item.cache.d}`}
              positionTestID={`hunt-discover-row-${index}`}
            />
          )}
        />
      )}
    </View>
  );
};

export default HuntNearbySection;
