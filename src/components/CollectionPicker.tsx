import React, { useCallback, useMemo } from 'react';
import type { Event } from 'nostr-tools';
import { FlatList, Text, TouchableOpacity, View } from 'react-native';
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
const CollectionPicker: React.FC<{
  collections: Event[];
  value: string[];
  onChange: (value: string[]) => void;
}> = ({ collections, value, onChange }) => {
  const t = useTranslation();
  const choices = useMemo(
    () =>
      collections
        .filter((e) => !isLegacyShopCollection(e))
        .map((e) => ({
          coordinate: `30405:${e.pubkey}:${e.tags.find((t) => t[0] === 'd')?.[1]}`,
          title: e.tags.find((t) => t[0] === 'title')?.[1] ?? '',
        })),
    [collections],
  );
  return (
    <ReferencePicker
      choices={choices}
      value={value}
      onChange={onChange}
      title={t('market.sell.collections')}
      testID="listing-collections"
    />
  );
};
export default React.memo(CollectionPicker);
