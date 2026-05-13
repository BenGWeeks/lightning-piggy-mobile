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
import { ChevronDown, ChevronUp, ShieldCheck, ShieldOff, X } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

// NIP-GC difficulty + terrain scales (geocaching.com convention adopted
// by treasures.to + LP). Each level has a one-line plain-English label
// so a first-time geocacher knows what "D3" or "T4" actually means.
const DIFFICULTY_LEVELS: Record<number, string> = {
  1: 'Walk-up, child can find it',
  2: 'Easy, beginner-friendly',
  3: 'Cunning hide, takes a look',
  4: 'Cryptic, puzzle-like',
  5: 'Expert — multi-stage or seriously hidden',
};

const TERRAIN_LEVELS: Record<number, string> = {
  1: 'Flat, wheelchair / pram accessible',
  2: 'Easy stroll, short walk',
  3: 'Rugged path, hiking boots',
  4: 'Steep / climbing, scrambling',
  5: 'Specialised gear required (kayak, rope, etc.)',
};

// Cache types come from the NIP-GC `t` tag, originally lifted from
// geocaching.com's taxonomy. Most users will only see "traditional"
// in the wild; the rest are surfaced when a hider uses them.
const TYPE_LABELS: Record<string, string> = {
  traditional: 'Walk to the geohash, find the container',
  multi: 'Multi-stage: solve clues to reach the final',
  mystery: 'Puzzle to solve before the coords make sense',
  virtual: 'No physical container — just visit the spot',
  event: 'Geocaching meet-up at a time + place',
  letterbox: 'Container with a stamp + logbook',
  earthcache: 'Geological / educational location',
  webcam: 'Pose in front of a public webcam',
};

const labelForType = (t: string): string => TYPE_LABELS[t] ?? 'Custom cache type';

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
  wotFilterEnabled: boolean;
  wotUntrustedHidden: number;
  onToggleWotFilter: () => void;
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
  wotFilterEnabled,
  wotUntrustedHidden,
  onToggleWotFilter,
  onClearAll,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
    !wotFilterEnabled;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="hunt-filter-backdrop" />
      <View style={styles.sheet} testID="hunt-filter-sheet">
        <View style={styles.handleBar} />
        <View style={styles.titleRow}>
          <Text style={styles.title}>Filters</Text>
          {anyActive ? (
            <TouchableOpacity
              onPress={onClearAll}
              testID="hunt-filter-clear-all"
              accessibilityLabel="Clear all filters"
            >
              <Text style={styles.clearText}>Clear all</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={onClose}
            testID="hunt-filter-close"
            accessibilityLabel="Close filters"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <X size={20} color={colors.textHeader} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Web-of-Trust */}
          <Text style={styles.section}>Safety</Text>
          <TouchableOpacity
            style={[styles.wotChip, wotFilterEnabled ? styles.wotChipOn : styles.wotChipOff]}
            onPress={onToggleWotFilter}
            disabled={!__DEV__}
            testID="hunt-filter-wot-chip"
          >
            {wotFilterEnabled ? (
              <ShieldCheck size={14} color={colors.brandPink} strokeWidth={2.5} />
            ) : (
              <ShieldOff size={14} color={colors.zapYellow} strokeWidth={2.5} />
            )}
            <Text style={styles.wotChipText}>
              {wotFilterEnabled
                ? wotUntrustedHidden > 0
                  ? `Web-of-Trust on • ${wotUntrustedHidden} hidden`
                  : 'Web-of-Trust on'
                : 'Web-of-Trust off (dev)'}
            </Text>
          </TouchableOpacity>
          {wotFilterEnabled ? (
            <Text style={styles.sectionHint}>
              An unverified geo-cache can be a lure — only listings from people you (or your
              follows) trust are shown.
            </Text>
          ) : null}

          {/* Difficulty */}
          <View style={styles.sectionHeader}>
            <Text style={styles.section}>Difficulty</Text>
            <TouchableOpacity
              onPress={() => setShowDifficultyGloss((v) => !v)}
              testID="hunt-filter-difficulty-glossary"
            >
              <Text style={styles.glossText}>
                {showDifficultyGloss ? 'Hide' : 'What do these mean?'}
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
                  accessibilityLabel={`Toggle difficulty ${n}`}
                >
                  <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>D{n}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {showDifficultyGloss ? (
            <View style={styles.glossBlock}>
              {Object.entries(DIFFICULTY_LEVELS).map(([n, label]) => (
                <Text key={n} style={styles.glossLine}>
                  <Text style={styles.glossLineKey}>D{n} —</Text> {label}
                </Text>
              ))}
            </View>
          ) : null}

          {/* Terrain */}
          <View style={styles.sectionHeader}>
            <Text style={styles.section}>Terrain</Text>
            <TouchableOpacity
              onPress={() => setShowTerrainGloss((v) => !v)}
              testID="hunt-filter-terrain-glossary"
            >
              <Text style={styles.glossText}>
                {showTerrainGloss ? 'Hide' : 'What do these mean?'}
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
                  accessibilityLabel={`Toggle terrain ${n}`}
                >
                  <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>T{n}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {showTerrainGloss ? (
            <View style={styles.glossBlock}>
              {Object.entries(TERRAIN_LEVELS).map(([n, label]) => (
                <Text key={n} style={styles.glossLine}>
                  <Text style={styles.glossLineKey}>T{n} —</Text> {label}
                </Text>
              ))}
            </View>
          ) : null}

          {/* Cache type */}
          {availableTypes.length > 0 ? (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.section}>Cache type</Text>
                <TouchableOpacity
                  onPress={() => setShowTypeGloss((v) => !v)}
                  testID="hunt-filter-type-glossary"
                >
                  <Text style={styles.glossText}>
                    {showTypeGloss ? 'Hide' : 'What do these mean?'}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.chipRow}>
                {availableTypes.map((t) => {
                  const active = selectedTypes.has(t);
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[styles.chip, active ? styles.chipActive : null]}
                      onPress={() => toggleInSet(selectedTypes, t, onChangeTypes)}
                      testID={`hunt-filter-type-${t}`}
                      accessibilityLabel={`Toggle ${t} type`}
                    >
                      <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                        {t}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {showTypeGloss ? (
                <View style={styles.glossBlock}>
                  {availableTypes.map((t) => (
                    <Text key={t} style={styles.glossLine}>
                      <Text style={styles.glossLineKey}>{t} —</Text> {labelForType(t)}
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
          accessibilityLabel="Apply filters"
        >
          <Text style={styles.doneText}>Done</Text>
        </TouchableOpacity>
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
  wotFilterEnabled: boolean;
}): number => {
  let n = 0;
  if (params.selectedDifficulties.size > 0) n += 1;
  if (params.selectedTerrains.size > 0) n += 1;
  if (params.selectedTypes.size > 0) n += 1;
  if (!params.wotFilterEnabled) n += 1;
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
    wotChip: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      marginTop: 8,
    },
    wotChipOn: {
      backgroundColor: colors.surface,
      borderColor: colors.brandPink,
    },
    wotChipOff: {
      backgroundColor: colors.surface,
      borderColor: colors.zapYellow,
    },
    wotChipText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textHeader,
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
