import { ReferenceChip, choiceKey, type Choice } from './CollectionPicker';
import React, { useCallback, useMemo } from 'react';
import type { Event } from 'nostr-tools';
import { FlatList, View } from 'react-native';
import { useTranslation } from '../contexts/LocaleContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { createMarketSellerStyles } from '../styles/MarketSeller.styles';
import { collectionCoordinate } from '../utils/marketCollectionFilters';
const MarketCollectionChips: React.FC<{
  collections: Event[];
  selected: string | null;
  onSelect: (coordinate: string | null) => void;
}> = ({ collections, selected, onSelect }) => {
  const t = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createMarketSellerStyles(colors), [colors]);
  const choices = useMemo(
    () => [
      { coordinate: 'all', title: t('market.sell.allCollections') },
      ...collections.map((event) => ({
        coordinate: collectionCoordinate(event),
        title: event.tags.find((t) => t[0] === 'title')?.[1] ?? '',
      })),
    ],
    [collections, t],
  );
  const select = useCallback(
    (coordinate: string) => onSelect(coordinate === 'all' ? null : coordinate),
    [onSelect],
  );
  const renderItem = useCallback(
    ({ item }: { item: Choice }) => (
      <ReferenceChip
        choice={item}
        selected={selected ? selected === item.coordinate : item.coordinate === 'all'}
        onSelect={select}
        styles={styles}
        radio
        testID={`collection-filter-${item.coordinate}`}
      />
    ),
    [selected, select, styles],
  );
  if (!collections.length) return null;
  return (
    <View testID="market-collection-filters">
      <FlatList
        horizontal
        data={choices}
        keyExtractor={choiceKey}
        renderItem={renderItem}
        contentContainerStyle={styles.referenceList}
        initialNumToRender={8}
        windowSize={5}
        testID="market-collection-filter-list"
      />
    </View>
  );
};
export default React.memo(MarketCollectionChips);
