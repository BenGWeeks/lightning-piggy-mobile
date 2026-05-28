import React, { useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

interface Props<T> {
  /** Section title — short, sentence case ("Places near you"). */
  title: string;
  /** Optional small caption rendered under the title in supplementary
   * text colour ("Powered by BTC Map" etc). */
  caption?: string;
  items: T[];
  renderItem: (item: T) => React.ReactElement;
  /** Stable key extractor so React doesn't re-render on every poll. */
  keyExtractor: (item: T) => string;
  /** Right-side action button — tap to navigate to the full sub-screen. */
  onSeeAll: () => void;
  /** testID for the see-all button (preserves Maestro flow continuity). */
  seeAllTestId?: string;
  /** Empty-state copy when items.length === 0. */
  emptyState?: React.ReactNode;
  /** When true, render a simple placeholder activity card. */
  loading?: boolean;
}

/**
 * Horizontal-scroll rail used on ExploreHomeScreen for each content
 * category (places / caches / events / lessons). Title row up top with
 * "See all →" link preserves the original `explore-card-*` testIDs so
 * existing Maestro flows continue to navigate via the rail.
 */
export function ContentRail<T>({
  title,
  caption,
  items,
  renderItem,
  keyExtractor,
  onSeeAll,
  seeAllTestId,
  emptyState,
  loading,
}: Props<T>): React.ReactElement {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.section}>
      <TouchableOpacity
        style={styles.header}
        onPress={onSeeAll}
        accessibilityLabel={`${title} — see all`}
        testID={seeAllTestId}
        activeOpacity={0.7}
      >
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          {caption ? <Text style={styles.caption}>{caption}</Text> : null}
        </View>
        <View style={styles.seeAll}>
          <Text style={styles.seeAllText}>See all</Text>
          <ChevronRight size={16} color={colors.brandPink} strokeWidth={2.5} />
        </View>
      </TouchableOpacity>

      {loading ? (
        <View style={styles.placeholderRow}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.placeholderCard} />
          ))}
        </View>
      ) : items.length === 0 ? (
        <View style={styles.emptyWrap}>{emptyState}</View>
      ) : (
        <FlatList
          horizontal
          data={items}
          keyExtractor={keyExtractor}
          renderItem={({ item }) => renderItem(item)}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </View>
  );
}

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    section: {
      marginBottom: 22,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      marginBottom: 10,
      gap: 12,
    },
    headerText: { flex: 1 },
    title: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textHeader,
    },
    caption: {
      fontSize: 12,
      color: colors.textSupplementary,
      marginTop: 2,
    },
    seeAll: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
    },
    seeAllText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.brandPink,
    },
    list: {
      paddingHorizontal: 16,
    },
    separator: {
      width: 10,
    },
    placeholderRow: {
      flexDirection: 'row',
      paddingHorizontal: 16,
      gap: 10,
    },
    placeholderCard: {
      width: 160,
      height: 130,
      backgroundColor: colors.surface,
      borderRadius: 12,
      opacity: 0.5,
    },
    emptyWrap: {
      paddingHorizontal: 16,
    },
  });
