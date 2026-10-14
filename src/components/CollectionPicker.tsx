import React, { useCallback, useMemo } from 'react';
import type { Event } from 'nostr-tools';
import { FlatList, Text, TouchableOpacity, View } from 'react-native';
import { Check, Plus } from 'lucide-react-native';
import { useTranslation } from '../contexts/LocaleContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { createMarketSellerStyles, type MarketSellerStyles } from '../styles/MarketSeller.styles';
import { isLegacyShopCollection } from '../utils/marketCollections';
export interface Choice {
  coordinate: string;
  title: string;
}
export const choiceKey = (choice: Choice) => choice.coordinate;
export const ReferenceChip = React.memo(function ReferenceChip({
  choice,
  selected,
  onSelect,
  styles,
  testID,
  radio = false,
}: {
  choice: Choice;
  selected: boolean;
  onSelect: (coordinate: string) => void;
  styles: MarketSellerStyles;
  testID: string;
  radio?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.secondaryButton, selected && styles.selectedReference]}
      testID={testID}
      accessibilityLabel={choice.title}
      accessibilityRole={radio ? 'radio' : 'checkbox'}
      accessibilityState={radio ? { selected } : { checked: selected }}
      onPress={() => onSelect(choice.coordinate)}
    >
      <Text style={styles.secondaryButtonText}>{choice.title}</Text>
    </TouchableOpacity>
  );
});
export function ReferencePicker({
  choices,
  value,
  onChange,
  title,
  testID,
}: {
  choices: Choice[];
  value: string[];
  onChange: (value: string[]) => void;
  title: string;
  testID: string;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => createMarketSellerStyles(colors), [colors]);
  const toggle = useCallback(
    (coordinate: string) =>
      onChange(
        value.includes(coordinate) ? value.filter((v) => v !== coordinate) : [...value, coordinate],
      ),
    [onChange, value],
  );
  const renderItem = useCallback(
    ({ item }: { item: Choice }) => (
      <ReferenceChip
        choice={item}
        selected={value.includes(item.coordinate)}
        onSelect={toggle}
        styles={styles}
        testID={`${testID}-${item.coordinate}`}
      />
    ),
    [value, toggle, styles, testID],
  );
  return (
    <View style={styles.field} testID={testID}>
      <Text style={styles.label}>{title}</Text>
      <FlatList
        horizontal
        data={choices}
        keyExtractor={choiceKey}
        renderItem={renderItem}
        contentContainerStyle={styles.referenceList}
        initialNumToRender={8}
        windowSize={5}
        testID={`${testID}-list`}
      />
    </View>
  );
}
interface CollectionChoice extends Choice {
  dTag: string;
}
const collectionChoiceKey = (choice: CollectionChoice) => choice.coordinate;

/** One selectable collection chip in the listing editor. */
const CollectionChip = React.memo(function CollectionChip({
  choice,
  selected,
  onToggle,
  styles,
}: {
  choice: CollectionChoice;
  selected: boolean;
  onToggle: (coordinate: string) => void;
  styles: MarketSellerStyles;
}) {
  return (
    <TouchableOpacity
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={() => onToggle(choice.coordinate)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={choice.title}
      testID={`listing-collection-chip-${choice.dTag}`}
    >
      {selected ? <Check size={14} color={styles.chipTextSelected.color} strokeWidth={3} /> : null}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{choice.title}</Text>
    </TouchableOpacity>
  );
});

/**
 * The listing editor's collections (#1534): the seller's collections as
 * multi-select chips (a listing MAY reference several via `a` tags), plus a
 * "+ New collection" chip that opens the create popup.
 */
const CollectionPicker: React.FC<{
  collections: Event[];
  value: string[];
  onChange: (value: string[]) => void;
  onNewCollection: () => void;
}> = ({ collections, value, onChange, onNewCollection }) => {
  const t = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createMarketSellerStyles(colors), [colors]);
  const choices = useMemo<CollectionChoice[]>(
    () =>
      collections
        .filter((e) => !isLegacyShopCollection(e))
        .map((e) => {
          const dTag = e.tags.find((tag) => tag[0] === 'd')?.[1] ?? '';
          return {
            dTag,
            coordinate: `30405:${e.pubkey}:${dTag}`,
            title: e.tags.find((tag) => tag[0] === 'title')?.[1] || dTag,
          };
        }),
    [collections],
  );
  const toggle = useCallback(
    (coordinate: string) =>
      onChange(
        value.includes(coordinate) ? value.filter((v) => v !== coordinate) : [...value, coordinate],
      ),
    [onChange, value],
  );
  const renderItem = useCallback(
    ({ item }: { item: CollectionChoice }) => (
      <CollectionChip
        choice={item}
        selected={value.includes(item.coordinate)}
        onToggle={toggle}
        styles={styles}
      />
    ),
    [value, toggle, styles],
  );
  const newChip = (
    <TouchableOpacity
      style={[styles.chip, styles.chipNew]}
      onPress={onNewCollection}
      accessibilityRole="button"
      accessibilityLabel={t('market.sell.newCollection.chip')}
      testID="listing-new-collection"
    >
      <Plus size={14} color={colors.brandPink} strokeWidth={3} />
      <Text style={[styles.chipText, styles.chipTextSelected]}>
        {t('market.sell.newCollection.chip')}
      </Text>
    </TouchableOpacity>
  );
  return (
    <View style={styles.field} testID="listing-collections">
      <Text style={styles.label}>{t('market.sell.collections')}</Text>
      <FlatList
        horizontal
        data={choices}
        keyExtractor={collectionChoiceKey}
        renderItem={renderItem}
        ListFooterComponent={newChip}
        contentContainerStyle={styles.chipScroll}
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={8}
        windowSize={5}
        testID="listing-collections-list"
      />
      {choices.length === 0 ? (
        <Text style={styles.hint}>{t('market.sell.newCollection.hint')}</Text>
      ) : null}
    </View>
  );
};
export default React.memo(CollectionPicker);
