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
import { useTranslation } from '../contexts/LocaleContext';
import { useTrustGraph } from '../contexts/TrustGraphContext';
import WebOfTrustChip from './WebOfTrustChip';
import WebOfTrustBottomSheet from './WebOfTrustBottomSheet';
import type { Palette } from '../styles/palettes';

// "Sort by" options on the Events list. Distance-first when location is
// known; date-first when the user wants chronological ordering regardless
// of where the meetup is.
export type EventsSortKey = 'date' | 'distance';

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
  const t = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // The WoT tier lives in TrustGraphContext; the picker UI is the shared
  // `WebOfTrustBottomSheet`. This sheet just renders the current-tier
  // chip and opens the picker on tap.
  const { wotTier } = useTrustGraph();
  const [wotSheetVisible, setWotSheetVisible] = useState(false);

  // Distance + date options are single-select max-caps (radio-style):
  // each picks a max-cap, so combining them would be meaningless. `id`
  // is a stable, locale-independent token used for testIDs; `label` is
  // the translated display string.
  const DISTANCE_OPTIONS: readonly { id: string; label: string; value: number | null }[] = useMemo(
    () => [
      { id: 'All', label: t('eventsFilterSheet.distanceAll'), value: null },
      { id: '5km', label: '5 km', value: 5_000 },
      { id: '25km', label: '25 km', value: 25_000 },
      { id: '150km', label: '150 km', value: 150_000 },
      { id: '500km', label: '500 km', value: 500_000 },
      { id: '1000km', label: '1000 km', value: 1_000_000 },
    ],
    [t],
  );

  const SORT_OPTIONS: readonly { label: string; value: EventsSortKey }[] = useMemo(
    () => [
      { label: t('eventsFilterSheet.sortDate'), value: 'date' },
      { label: t('eventsFilterSheet.sortDistance'), value: 'distance' },
    ],
    [t],
  );

  const DATE_OPTIONS: readonly { id: string; label: string; value: number | null }[] = useMemo(
    () => [
      { id: 'Anytime', label: t('eventsFilterSheet.dateAnytime'), value: null },
      { id: 'Today', label: t('eventsFilterSheet.dateToday'), value: 24 * 60 * 60 },
      { id: 'Thisweek', label: t('eventsFilterSheet.dateThisWeek'), value: 7 * 24 * 60 * 60 },
      { id: 'Thismonth', label: t('eventsFilterSheet.dateThisMonth'), value: 31 * 24 * 60 * 60 },
    ],
    [t],
  );

  const anyActive = maxDistanceMetres !== null || maxFromNowSec !== null || wotTier !== 'all';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} testID="events-filter-backdrop" />
      {/* Hide the filter sheet while the WoT bottom sheet is open so its
          Done button doesn't peek out below — see matching note in
          HuntFilterSheet. */}
      <View
        style={[styles.sheet, wotSheetVisible && styles.sheetHidden]}
        pointerEvents={wotSheetVisible ? 'none' : 'auto'}
        testID="events-filter-sheet"
      >
        <View style={styles.handleBar} />
        <View style={styles.titleRow}>
          <Text style={styles.title}>{t('eventsFilterSheet.title')}</Text>
          {anyActive ? (
            <TouchableOpacity
              onPress={onClearAll}
              testID="events-filter-clear-all"
              accessibilityLabel={t('eventsFilterSheet.clearAllAccessibility')}
            >
              <Text style={styles.clearText}>{t('eventsFilterSheet.clearAll')}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={onClose}
            testID="events-filter-close"
            accessibilityLabel={t('eventsFilterSheet.closeAccessibility')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <X size={20} color={colors.textHeader} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Web-of-Trust — chip + tap-to-open-sheet (#535) */}
          <Text style={styles.section}>{t('eventsFilterSheet.safety')}</Text>
          <View style={styles.wotRow}>
            <WebOfTrustChip
              currentTier={wotTier}
              onPress={() => setWotSheetVisible(true)}
              testID="events-filter-wot-chip"
            />
            {wotUntrustedHidden > 0 ? (
              <Text style={styles.wotHiddenCount}>
                {t('eventsFilterSheet.hiddenCount', { count: wotUntrustedHidden })}
              </Text>
            ) : null}
          </View>
          <Text style={styles.sectionHint}>{t('eventsFilterSheet.safetyHint')}</Text>

          {/* Sort by — single-select. Default 'date' (chronological is the
            most natural ordering for a meetup list), but distance-sort
            useful when the user is filtering for a wide radius and wants
            to see the nearest meetups first. */}
          <Text style={styles.section}>{t('eventsFilterSheet.sortBy')}</Text>
          <View style={styles.chipRow}>
            {SORT_OPTIONS.map((opt) => {
              const active = sortBy === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.chip, active ? styles.chipActive : null]}
                  onPress={() => onChangeSortBy(opt.value)}
                  testID={`events-filter-sort-${opt.value}`}
                  accessibilityLabel={t('eventsFilterSheet.sortByLabel', { label: opt.label })}
                >
                  <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Distance — single-select max-cap */}
          <Text style={styles.section}>{t('eventsFilterSheet.distance')}</Text>
          <View style={styles.chipRow}>
            {DISTANCE_OPTIONS.map((opt) => {
              const active = maxDistanceMetres === opt.value;
              return (
                <TouchableOpacity
                  key={opt.id}
                  style={[styles.chip, active ? styles.chipActive : null]}
                  onPress={() => onChangeMaxDistance(opt.value)}
                  testID={`events-filter-distance-${opt.id}`}
                  accessibilityLabel={t('eventsFilterSheet.showEventsWithin', {
                    distance: opt.label,
                  })}
                >
                  <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Date range — single-select max-cap */}
          <Text style={styles.section}>{t('eventsFilterSheet.dateRange')}</Text>
          <View style={styles.chipRow}>
            {DATE_OPTIONS.map((opt) => {
              const active = maxFromNowSec === opt.value;
              return (
                <TouchableOpacity
                  key={opt.id}
                  style={[styles.chip, active ? styles.chipActive : null]}
                  onPress={() => onChangeMaxFromNow(opt.value)}
                  testID={`events-filter-date-${opt.id}`}
                  accessibilityLabel={t('eventsFilterSheet.showEventsDate', { range: opt.label })}
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
          accessibilityLabel={t('eventsFilterSheet.applyAccessibility')}
        >
          <Text style={styles.doneText}>{t('eventsFilterSheet.done')}</Text>
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
