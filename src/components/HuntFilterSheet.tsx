import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  Pressable,
} from 'react-native';
import { ChevronDown, ChevronUp, X } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTrustGraph } from '../contexts/TrustGraphContext';
import { useTranslation } from '../contexts/LocaleContext';
import WebOfTrustChip from './WebOfTrustChip';
import WebOfTrustBottomSheet from './WebOfTrustBottomSheet';
import type { Palette } from '../styles/palettes';

// Cache types come from the NIP-GC `t` tag, originally lifted from
// geocaching.com's taxonomy. This is the known set that has a friendly
// glossary label; anything outside it falls back to a generic label.
const KNOWN_CACHE_TYPES = [
  'traditional',
  'multi',
  'mystery',
  'virtual',
  'event',
  'letterbox',
  'earthcache',
  'webcam',
];

interface Props {
  visible: boolean;
  onClose: () => void;
  selectedDifficulties: Set<number>;
  onChangeDifficulties: (next: Set<number>) => void;
  selectedTerrains: Set<number>;
  onChangeTerrains: (next: Set<number>) => void;
  availableTypes: string[];
  selectedTypes: Set<string>;
  onChangeTypes: (next: Set<string>) => void;
  // How many caches were hidden by the current WoT tier. Displayed next to
  // the chip as a small hint ("N hidden") when > 0.
  wotUntrustedHidden: number;
  onClearAll: () => void;
}

const HuntFilterSheet: React.FC<Props> = ({
  visible,
  onClose,
  selectedDifficulties,
  onChangeDifficulties,
  selectedTerrains,
  onChangeTerrains,
  availableTypes,
  selectedTypes,
  onChangeTypes,
  wotUntrustedHidden,
  onClearAll,
}) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // The WoT picker is owned by `WebOfTrustBottomSheet` — this sheet
  // surfaces the *current* tier via `WebOfTrustChip` and opens the
  // tier-picker sheet on tap. Single source of truth across surfaces.
  const { wotTier } = useTrustGraph();
  const [wotSheetVisible, setWotSheetVisible] = useState(false);
  // Glossary is hidden by default — most users don't need it after
  // the first read. Each scale + the type vocab gets its own toggle.
  const [showDifficultyGloss, setShowDifficultyGloss] = useState(false);
  const [showTerrainGloss, setShowTerrainGloss] = useState(false);
  const [showTypeGloss, setShowTypeGloss] = useState(false);

  const toggleInSet = <T,>(set: Set<T>, value: T, onChange: (next: Set<T>) => void): void => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  };

  const anyActive =
    selectedDifficulties.size > 0 ||
    selectedTerrains.size > 0 ||
    selectedTypes.size > 0 ||
    wotTier !== 'all';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} testID="hunt-filter-backdrop" />
      {/* Hide the filter sheet itself while the WoT bottom sheet is open
          so its "Done" button doesn't peek out below the WoT sheet — both
          sheets are bottom-anchored Modals, and the WoT sheet's translucent
          backdrop would otherwise let the underlying filter Done bleed
          through. Keep the View mounted (just visually hidden + pointer-
          inert) so the WoT modal's state remains intact. */}
      <View
        style={[styles.sheet, wotSheetVisible && styles.sheetHidden]}
        pointerEvents={wotSheetVisible ? 'none' : 'auto'}
        testID="hunt-filter-sheet"
      >
        <View style={styles.handleBar} />
        <View style={styles.titleRow}>
          <Text style={styles.title}>{t('huntFilterSheet.filters')}</Text>
          {anyActive ? (
            <TouchableOpacity
              onPress={onClearAll}
              testID="hunt-filter-clear-all"
              accessibilityLabel={t('huntFilterSheet.clearAllFilters')}
            >
              <Text style={styles.clearText}>{t('huntFilterSheet.clearAll')}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={onClose}
            testID="hunt-filter-close"
            accessibilityLabel={t('huntFilterSheet.closeFilters')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <X size={20} color={colors.textHeader} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Web-of-Trust — chip + tap-to-open-sheet (#535) */}
          <Text style={styles.section}>{t('huntFilterSheet.safety')}</Text>
          <View style={styles.wotRow}>
            <WebOfTrustChip
              currentTier={wotTier}
              onPress={() => setWotSheetVisible(true)}
              testID="hunt-filter-wot-chip"
            />
            {wotUntrustedHidden > 0 ? (
              <Text style={styles.wotHiddenCount}>
                {t('huntFilterSheet.hiddenCount', { count: wotUntrustedHidden })}
              </Text>
            ) : null}
          </View>
          <Text style={styles.sectionHint}>{t('huntFilterSheet.sectionHint')}</Text>

          {/* Difficulty */}
          <View style={styles.sectionHeader}>
            <Text style={styles.section}>{t('huntFilterSheet.difficulty')}</Text>
            <TouchableOpacity
              onPress={() => setShowDifficultyGloss((v) => !v)}
              testID="hunt-filter-difficulty-glossary"
            >
              <Text style={styles.glossText}>
                {showDifficultyGloss
                  ? t('huntFilterSheet.hide')
                  : t('huntFilterSheet.whatDoTheseMean')}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={styles.chipRow}>
            {[1, 2, 3, 4, 5].map((n) => {
              const active = selectedDifficulties.has(n);
              return (
                <TouchableOpacity
                  key={n}
                  style={[styles.chip, active ? styles.chipActive : null]}
                  onPress={() => toggleInSet(selectedDifficulties, n, onChangeDifficulties)}
                  testID={`hunt-filter-difficulty-${n}`}
                  accessibilityLabel={t('huntFilterSheet.toggleDifficulty', { n })}
                >
                  <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>D{n}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {showDifficultyGloss ? (
            <View style={styles.glossBlock}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Text key={n} style={styles.glossLine}>
                  <Text style={styles.glossLineKey}>D{n} —</Text>{' '}
                  {t(`huntFilterSheet.difficulty${n}`)}
                </Text>
              ))}
            </View>
          ) : null}

          {/* Terrain */}
          <View style={styles.sectionHeader}>
            <Text style={styles.section}>{t('huntFilterSheet.terrain')}</Text>
            <TouchableOpacity
              onPress={() => setShowTerrainGloss((v) => !v)}
              testID="hunt-filter-terrain-glossary"
            >
              <Text style={styles.glossText}>
                {showTerrainGloss
                  ? t('huntFilterSheet.hide')
                  : t('huntFilterSheet.whatDoTheseMean')}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={styles.chipRow}>
            {[1, 2, 3, 4, 5].map((n) => {
              const active = selectedTerrains.has(n);
              return (
                <TouchableOpacity
                  key={n}
                  style={[styles.chip, active ? styles.chipActive : null]}
                  onPress={() => toggleInSet(selectedTerrains, n, onChangeTerrains)}
                  testID={`hunt-filter-terrain-${n}`}
                  accessibilityLabel={t('huntFilterSheet.toggleTerrain', { n })}
                >
                  <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>T{n}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {showTerrainGloss ? (
            <View style={styles.glossBlock}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Text key={n} style={styles.glossLine}>
                  <Text style={styles.glossLineKey}>T{n} —</Text> {t(`huntFilterSheet.terrain${n}`)}
                </Text>
              ))}
            </View>
          ) : null}

          {/* Cache type */}
          {availableTypes.length > 0 ? (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.section}>{t('huntFilterSheet.cacheType')}</Text>
                <TouchableOpacity
                  onPress={() => setShowTypeGloss((v) => !v)}
                  testID="hunt-filter-type-glossary"
                >
                  <Text style={styles.glossText}>
                    {showTypeGloss
                      ? t('huntFilterSheet.hide')
                      : t('huntFilterSheet.whatDoTheseMean')}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.chipRow}>
                {availableTypes.map((type) => {
                  const active = selectedTypes.has(type);
                  return (
                    <TouchableOpacity
                      key={type}
                      style={[styles.chip, active ? styles.chipActive : null]}
                      onPress={() => toggleInSet(selectedTypes, type, onChangeTypes)}
                      testID={`hunt-filter-type-${type}`}
                      accessibilityLabel={t('huntFilterSheet.toggleType', { type })}
                    >
                      <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                        {type}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {showTypeGloss ? (
                <View style={styles.glossBlock}>
                  {availableTypes.map((type) => (
                    <Text key={type} style={styles.glossLine}>
                      <Text style={styles.glossLineKey}>{type} —</Text>{' '}
                      {KNOWN_CACHE_TYPES.includes(type)
                        ? t(`huntFilterSheet.type_${type}`)
                        : t('huntFilterSheet.typeCustom')}
                    </Text>
                  ))}
                </View>
              ) : null}
            </>
          ) : null}
        </ScrollView>

        <TouchableOpacity
          style={styles.doneButton}
          onPress={onClose}
          testID="hunt-filter-done"
          accessibilityLabel={t('huntFilterSheet.applyFilters')}
        >
          <Text style={styles.doneText}>{t('huntFilterSheet.done')}</Text>
        </TouchableOpacity>

        {/* Nested sheet — opens on chip tap. */}
        <WebOfTrustBottomSheet
          visible={wotSheetVisible}
          onClose={() => setWotSheetVisible(false)}
        />
      </View>
    </Modal>
  );
};

// Exported so the host screen can reuse the activeFilterCount calc for
// the badge on the filter icon, and the type-label lookup for tooltip
// rendering elsewhere.
export const countActiveFilters = (params: {
  selectedDifficulties: Set<number>;
  selectedTerrains: Set<number>;
  selectedTypes: Set<string>;
  // Active when the user has widened past the default 'friends' tier.
  wotTier: 'friends' | 'fof' | 'all';
}): number => {
  let n = 0;
  if (params.selectedDifficulties.size > 0) n += 1;
  if (params.selectedTerrains.size > 0) n += 1;
  if (params.selectedTypes.size > 0) n += 1;
  if (params.wotTier !== 'all') n += 1;
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
    sheetHidden: {
      opacity: 0,
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
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 18,
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
      marginTop: 6,
      lineHeight: 17,
    },
    glossText: {
      fontSize: 12,
      color: colors.brandPink,
      fontWeight: '600',
    },
    glossBlock: {
      marginTop: 8,
      padding: 10,
      borderRadius: 8,
      backgroundColor: colors.surface,
      gap: 4,
    },
    glossLine: {
      fontSize: 12,
      color: colors.textBody,
      lineHeight: 17,
    },
    glossLineKey: {
      fontWeight: '700',
      color: colors.textHeader,
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
    },
    chipTextActive: {
      color: colors.white,
    },
    wotRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 8,
    },
    wotHiddenCount: {
      fontSize: 12,
      color: colors.textSupplementary,
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

// Re-export the (unused-here-but-kept-for-API-completeness) icons so
// HuntScreen can render the same chevron next to the filter icon if it
// wants a "X active" badge that matches the open-state direction.
export { ChevronDown, ChevronUp };

export default HuntFilterSheet;
