import React, { useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  Pressable,
} from 'react-native';
import { X } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

interface Props {
  visible: boolean;
  onClose: () => void;
  availableCategories: string[];
  selectedCategories: Set<string>;
  onChangeCategories: (next: Set<string>) => void;
  onClearAll: () => void;
}

// Bottom-sheet filter UI for PlacesScreen. Mirrors HuntFilterSheet's
// structure (backdrop + handle + title row + Done button) so the two
// Explore-stack filters feel identical. PlacesScreen only filters by
// merchant category — distance is handled by the mini-map bbox and
// there's no trust gating on BTC Map merchants.
const PlacesFilterSheet: React.FC<Props> = ({
  visible,
  onClose,
  availableCategories,
  selectedCategories,
  onChangeCategories,
  onClearAll,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const toggleCategory = (cat: string): void => {
    const next = new Set(selectedCategories);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    onChangeCategories(next);
  };

  const anyActive = selectedCategories.size > 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="places-filter-backdrop" />
      <View style={styles.sheet} testID="places-filter-sheet">
        <View style={styles.handleBar} />
        <View style={styles.titleRow}>
          <Text style={styles.title}>Filters</Text>
          {anyActive ? (
            <TouchableOpacity
              onPress={onClearAll}
              testID="places-filter-clear-all"
              accessibilityLabel="Clear all filters"
            >
              <Text style={styles.clearText}>Clear all</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={onClose}
            testID="places-filter-close"
            accessibilityLabel="Close filters"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <X size={20} color={colors.textHeader} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          {availableCategories.length > 0 ? (
            <>
              <Text style={styles.section}>Category</Text>
              <View style={styles.chipRow}>
                {availableCategories.map((cat) => {
                  const active = selectedCategories.has(cat);
                  return (
                    <TouchableOpacity
                      key={cat}
                      style={[styles.chip, active ? styles.chipActive : null]}
                      onPress={() => toggleCategory(cat)}
                      testID={`places-filter-cat-${cat}`}
                      accessibilityLabel={`${cat} category ${active ? 'on' : 'off'}`}
                    >
                      <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                        {cat.replace(/_/g, ' ')}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          ) : (
            <Text style={styles.sectionHint}>
              No categories available yet — merchants are still loading.
            </Text>
          )}
        </ScrollView>

        <TouchableOpacity
          style={styles.doneButton}
          onPress={onClose}
          testID="places-filter-done"
          accessibilityLabel="Apply filters"
        >
          <Text style={styles.doneText}>Done</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
};

// Exported so the host screen can reuse the count for the icon badge.
export const countActiveFilters = (params: { selectedCategories: Set<string> }): number => {
  let n = 0;
  if (params.selectedCategories.size > 0) n += 1;
  return n;
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.4)',
    },
    sheet: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      maxHeight: '85%',
      backgroundColor: colors.background,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 20,
      paddingBottom: 28,
      paddingTop: 8,
    },
    handleBar: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.divider,
      marginBottom: 10,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 4,
    },
    title: {
      flex: 1,
      fontSize: 20,
      fontWeight: '800',
      color: colors.textHeader,
    },
    clearText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.brandPink,
    },
    scroll: {
      flexGrow: 0,
    },
    section: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSupplementary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 18,
    },
    sectionHint: {
      fontSize: 12,
      color: colors.textSupplementary,
      marginTop: 18,
      lineHeight: 17,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 10,
    },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    chipActive: {
      backgroundColor: colors.brandPink,
      borderColor: colors.brandPink,
    },
    chipText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textHeader,
      textTransform: 'capitalize',
    },
    chipTextActive: {
      color: colors.white,
    },
    doneButton: {
      marginTop: 16,
      paddingVertical: 14,
      borderRadius: 999,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
    },
    doneText: {
      color: colors.white,
      fontSize: 15,
      fontWeight: '700',
    },
  });

export default PlacesFilterSheet;
