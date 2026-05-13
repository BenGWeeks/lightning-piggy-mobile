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
import { X } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTrustGraph } from '../contexts/TrustGraphContext';
import WebOfTrustChip from './WebOfTrustChip';
import WebOfTrustBottomSheet from './WebOfTrustBottomSheet';
import type { Palette } from '../styles/palettes';

// Distance + date options live next to the component so the sheet
// stays self-contained — same chip-row pattern as HuntFilterSheet but
// single-select (radio-style): each picks a max-cap, so combining
// them would be meaningless.
const DISTANCE_OPTIONS: readonly { label: string; value: number | null }[] = [
  { label: 'All', value: null },
  { label: '5 km', value: 5_000 },
  { label: '25 km', value: 25_000 },
  { label: '150 km', value: 150_000 },
  { label: '500 km', value: 500_000 },
  { label: '1000 km', value: 1_000_000 },
];

// "Sort by" options on the Events list. Distance-first when location is
// known; date-first when the user wants chronological ordering regardless
// of where the meetup is.
export type EventsSortKey = 'date' | 'distance';
const SORT_OPTIONS: readonly { label: string; value: EventsSortKey }[] = [
  { label: 'Date', value: 'date' },
  { label: 'Distance', value: 'distance' },
];

const DATE_OPTIONS: readonly { label: string; value: number | null }[] = [
  { label: 'Anytime', value: null },
  { label: 'Today', value: 24 * 60 * 60 },
  { label: 'This week', value: 7 * 24 * 60 * 60 },
  { label: 'This month', value: 31 * 24 * 60 * 60 },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  maxDistanceMetres: number | null;
  onChangeMaxDistance: (next: number | null) => void;
  maxFromNowSec: number | null;
  onChangeMaxFromNow: (next: number | null) => void;
  // How many events the current WoT tier is hiding — displayed alongside
  // the chip as a small "N hidden" hint when > 0.
  wotUntrustedHidden: number;
  sortBy: EventsSortKey;
  onChangeSortBy: (next: EventsSortKey) => void;
  onClearAll: () => void;
}

const EventsFilterSheet: React.FC<Props> = ({
  visible,
  onClose,
  maxDistanceMetres,
  onChangeMaxDistance,
  maxFromNowSec,
  onChangeMaxFromNow,
  wotUntrustedHidden,
  sortBy,
  onChangeSortBy,
  onClearAll,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // The WoT tier lives in TrustGraphContext; the picker UI is the shared
  // `WebOfTrustBottomSheet`. This sheet just renders the current-tier
  // chip and opens the picker on tap.
  const { wotTier } = useTrustGraph();
  const [wotSheetVisible, setWotSheetVisible] = useState(false);

  const anyActive = maxDistanceMetres !== null || maxFromNowSec !== null || wotTier !== 'friends';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="events-filter-backdrop" />
      <View style={styles.sheet} testID="events-filter-sheet">
        <View style={styles.handleBar} />
        <View style={styles.titleRow}>
          <Text style={styles.title}>Filters</Text>
          {anyActive ? (
            <TouchableOpacity
              onPress={onClearAll}
              testID="events-filter-clear-all"
              accessibilityLabel="Clear all filters"
            >
              <Text style={styles.clearText}>Clear all</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={onClose}
            testID="events-filter-close"
            accessibilityLabel="Close filters"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <X size={20} color={colors.textHeader} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Web-of-Trust — chip + tap-to-open-sheet (#535) */}
          <Text style={styles.section}>Safety</Text>
          <View style={styles.wotRow}>
            <WebOfTrustChip
              currentTier={wotTier}
              onPress={() => setWotSheetVisible(true)}
              testID="events-filter-wot-chip"
            />
            {wotUntrustedHidden > 0 ? (
              <Text style={styles.wotHiddenCount}>{wotUntrustedHidden} hidden</Text>
            ) : null}
          </View>
          <Text style={styles.sectionHint}>
            Only events from organisers your trust graph reaches are shown — tap the chip to widen
            the tier.
          </Text>

          {/* Sort by — single-select. Default 'date' (chronological is the
            most natural ordering for a meetup list), but distance-sort
            useful when the user is filtering for a wide radius and wants
            to see the nearest meetups first. */}
          <Text style={styles.section}>Sort by</Text>
          <View style={styles.chipRow}>
            {SORT_OPTIONS.map((opt) => {
              const active = sortBy === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.chip, active ? styles.chipActive : null]}
                  onPress={() => onChangeSortBy(opt.value)}
                  testID={`events-filter-sort-${opt.value}`}
                  accessibilityLabel={`Sort by ${opt.label}`}
                >
                  <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Distance — single-select max-cap */}
          <Text style={styles.section}>Distance</Text>
          <View style={styles.chipRow}>
            {DISTANCE_OPTIONS.map((opt) => {
              const active = maxDistanceMetres === opt.value;
              return (
                <TouchableOpacity
                  key={opt.label}
                  style={[styles.chip, active ? styles.chipActive : null]}
                  onPress={() => onChangeMaxDistance(opt.value)}
                  testID={`events-filter-distance-${opt.label.replace(/\s/g, '')}`}
                  accessibilityLabel={`Show events within ${opt.label}`}
                >
                  <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Date range — single-select max-cap */}
          <Text style={styles.section}>Date range</Text>
          <View style={styles.chipRow}>
            {DATE_OPTIONS.map((opt) => {
              const active = maxFromNowSec === opt.value;
              return (
                <TouchableOpacity
                  key={opt.label}
                  style={[styles.chip, active ? styles.chipActive : null]}
                  onPress={() => onChangeMaxFromNow(opt.value)}
                  testID={`events-filter-date-${opt.label.replace(/\s/g, '')}`}
                  accessibilityLabel={`Show events ${opt.label}`}
                >
                  <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>

        <TouchableOpacity
          style={styles.doneButton}
          onPress={onClose}
          testID="events-filter-done"
          accessibilityLabel="Apply filters"
        >
          <Text style={styles.doneText}>Done</Text>
        </TouchableOpacity>

        <WebOfTrustBottomSheet
          visible={wotSheetVisible}
          onClose={() => setWotSheetVisible(false)}
        />
      </View>
    </Modal>
  );
};

// Mirrors HuntFilterSheet.countActiveFilters so the host screen can
// render a badge on the filter icon with the same accounting rules.
export const countActiveFilters = (params: {
  maxDistanceMetres: number | null;
  maxFromNowSec: number | null;
  wotTier: 'friends' | 'fof' | 'all';
}): number => {
  let n = 0;
  if (params.maxDistanceMetres !== null) n += 1;
  if (params.maxFromNowSec !== null) n += 1;
  if (params.wotTier !== 'friends') n += 1;
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
      marginTop: 6,
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

export default EventsFilterSheet;
