import MarketMerchantFilter from './MarketMerchantFilter';
import type { MarketMerchant } from '../utils/marketMerchants';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  Pressable,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { Check, X } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createMarketFilterBarStyles } from '../styles/MarketFilterBar.styles';
import { vendorSlug } from '../utils/marketVendors';
import { perfLog } from '../utils/perfLog';
import { MARKET_MODE_OPTIONS, type MarketMode } from '../utils/marketMode';
import { SATS_CURRENCY_CODE } from '../utils/currencyCode';

interface Props {
  mode: MarketMode;
  onSelectMode: (mode: MarketMode) => void;
  /** Whether the filter panel is open. */
  visible: boolean;
  /** Close the panel (backdrop tap, Done, or Android back). */
  onClose: () => void;
  /** Distinct merchants present in the data; `null` selection means "All". */
  merchants: MarketMerchant[];
  selectedMerchant: string | null;
  onSelectMerchant: (merchant: string | null) => void;
  /** Distinct countries present in the data; `null` selection means "All". */
  countries: string[];
  selectedCountry: string | null;
  onSelectCountry: (country: string | null) => void;
  /** Distinct canonical currency codes in the data (see `normalizeCurrencyCode`);
   * `null` selection means "All". */
  currencies: string[];
  selectedCurrency: string | null;
  onSelectCurrency: (currency: string | null) => void;
  /** Whether any panel axis is active — shows the Clear affordance. */
  active: boolean;
  onClear: () => void;
}

/** A single selectable filter chip. */
const Chip: React.FC<{
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
  styles: ReturnType<typeof createMarketFilterBarStyles>;
}> = ({ label, selected, onPress, testID, styles }) => {
  const t = useTranslation();
  return (
    <TouchableOpacity
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
      accessibilityState={{ selected }}
      accessibilityLabel={selected ? t('market.filters.chipSelected', { label }) : label}
      testID={testID}
      activeOpacity={0.7}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

/**
 * Right-anchored, slide-in **filter panel** for the Market screen.
 *
 * Houses the seller scope / merchant / country / currency filter controls so the main view
 * stays compact — the header keeps only the inline search box plus a filter
 * icon that opens this panel. The chip axes are sourced from the DISTINCT
 * values present in the loaded products (passed in by the screen) rather than
 * hardcoded, so they stay correct as the catalogue changes; each section leads
 * with an "All" chip that clears that axis. Selections apply LIVE to the grid
 * behind the panel (no Apply step), so "Done" simply closes it. A "Clear
 * filters" row resets every panel axis at once and only shows while one is
 * active.
 *
 * Presentational only — no filtering logic lives here (that's the pure
 * `utils/marketFilters` module); this just renders controls and reports
 * selections up. The panel slides in from the right over a tap-to-dismiss
 * backdrop.
 */
const MarketFilterBar: React.FC<Props> = ({
  mode,
  onSelectMode,
  visible,
  onClose,
  merchants,
  selectedMerchant,
  onSelectMerchant,
  countries,
  selectedCountry,
  onSelectCountry,
  currencies,
  selectedCurrency,
  onSelectCurrency,
  active,
  onClear,
}) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createMarketFilterBarStyles(colors), [colors]);

  // Panel width: a comfortable drawer that leaves the grid peeking behind it.
  const { width: windowWidth } = useWindowDimensions();
  const panelWidth = useMemo(() => Math.min(360, Math.round(windowWidth * 0.86)), [windowWidth]);

  // Slide-in-from-right animation. `rendered` keeps the Modal mounted through
  // the exit transition so the panel animates OUT before it unmounts.
  const translateX = useRef(new Animated.Value(panelWidth)).current;
  const [rendered, setRendered] = useState(visible);
  // Track the previous open state so we only animate on an actual open/close
  // TRANSITION — not on every re-run (e.g. a `panelWidth` change from rotation
  // while the panel is already open, which must NOT re-trigger the slide).
  const wasVisible = useRef(false);

  useEffect(() => {
    const opening = visible && !wasVisible.current;
    const closing = !visible && wasVisible.current;
    wasVisible.current = visible;

    if (opening) {
      setRendered(true);
      // Snap to the CURRENT panel width before animating in, so a width change
      // while the panel was closed (rotation / tablet resize) can't leave the
      // ref holding a stale width and briefly show the drawer partially
      // on-screen — it always starts fully off to the right.
      translateX.setValue(panelWidth);
      Animated.timing(translateX, { toValue: 0, duration: 220, useNativeDriver: true }).start();
    } else if (closing) {
      Animated.timing(translateX, {
        toValue: panelWidth,
        duration: 200,
        useNativeDriver: true,
      }).start(({ finished }) => {
        // RN stops the previous animation (finished=false) when a new one
        // starts on the same value, but guard on the CURRENT open state too so
        // a stale close callback can never unmount a reopened panel.
        if (finished && !wasVisible.current) setRendered(false);
      });
    } else if (!visible) {
      // Closed and a width change came through (rotation while closed): keep the
      // off-screen resting position in sync so the NEXT open still starts fully
      // hidden. Deliberately does nothing while OPEN, so rotation mid-session
      // can't make the drawer jump off and slide back in.
      translateX.setValue(panelWidth);
    }
  }, [visible, panelWidth, translateX]);

  if (!rendered) return null;

  return (
    <Modal
      visible={rendered}
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={onClose}
      onShow={() => perfLog('[PerfBlock] market filter panel shown')}
    >
      <Pressable style={styles.backdrop} onPress={onClose} testID="market-filter-backdrop" />
      <Animated.View
        style={[styles.panel, { width: panelWidth, transform: [{ translateX }] }]}
        testID="market-filter-panel"
      >
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>{t('market.filters.title')}</Text>
          {active ? (
            <TouchableOpacity
              onPress={onClear}
              accessibilityLabel={t('market.filters.clearAll')}
              testID="market-filter-clear"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.clearText}>{t('market.filters.clear')}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={onClose}
            accessibilityLabel={t('market.filters.close')}
            testID="market-filter-close"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <X size={20} color={colors.textHeader} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.panelScroll}
          contentContainerStyle={styles.panelScrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.section} testID="market-filter-sellers">
            <Text style={styles.sectionLabel}>{t('market.filters.sellers')}</Text>
            {MARKET_MODE_OPTIONS.filter((option) => option.mode !== 'wotAll').map((option) => {
              const selected = mode === option.mode;
              const label = t(
                option.mode === 'preferred'
                  ? option.labelKey
                  : option.mode === 'wotFriends'
                    ? 'market.filters.friends'
                    : 'market.filters.friendsOfFriends',
              );
              const id =
                option.mode === 'preferred'
                  ? 'preferred'
                  : option.mode === 'wotFriends'
                    ? 'friends'
                    : 'friends-of-friends';
              return (
                <TouchableOpacity
                  key={option.mode}
                  style={[
                    styles.sellerOption,
                    selected && styles.chipSelected,
                    !option.enabled && styles.sellerOptionDisabled,
                  ]}
                  onPress={() => {
                    if (option.enabled) onSelectMode(option.mode);
                  }}
                  disabled={!option.enabled}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, disabled: !option.enabled }}
                  accessibilityLabel={
                    option.enabled ? label : t('market.modes.comingSoon', { label })
                  }
                  testID={`market-filter-sellers-${id}`}
                  activeOpacity={0.7}
                >
                  <View style={styles.sellerCopy}>
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {label}
                    </Text>
                    {!option.enabled ? (
                      <Text style={styles.sellerHint}>{t('market.filters.comingSoon')}</Text>
                    ) : null}
                  </View>
                  {selected ? <Check size={18} color={colors.white} strokeWidth={2.5} /> : null}
                </TouchableOpacity>
              );
            })}
          </View>
          {merchants.length > 0 ? (
            <MarketMerchantFilter
              merchants={merchants}
              selected={selectedMerchant}
              onSelect={onSelectMerchant}
            />
          ) : null}

          {/* Country */}
          {countries.length > 0 ? (
            <View style={styles.section} testID="market-filter-countries">
              <Text style={styles.sectionLabel}>{t('market.filters.country')}</Text>
              <View style={styles.chipWrap}>
                <Chip
                  label={t('market.filters.all')}
                  selected={selectedCountry === null}
                  onPress={() => onSelectCountry(null)}
                  testID="market-filter-country-all"
                  styles={styles}
                />
                {countries.map((c) => (
                  <Chip
                    key={c}
                    label={c}
                    selected={selectedCountry === c}
                    onPress={() => onSelectCountry(selectedCountry === c ? null : c)}
                    // Slugify the country so the testID has no spaces (e.g.
                    // "United Kingdom" -> "united-kingdom"), keeping Maestro
                    // selectors stable — matching the codebase's filter-chip
                    // convention (per Copilot review on #948).
                    testID={`market-filter-country-${vendorSlug(c)}`}
                    styles={styles}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {/* Currency */}
          {currencies.length > 0 ? (
            <View style={styles.section} testID="market-filter-currencies">
              <Text style={styles.sectionLabel}>{t('market.filters.currency')}</Text>
              <View style={styles.chipWrap}>
                <Chip
                  label={t('market.filters.all')}
                  selected={selectedCurrency === null}
                  onPress={() => onSelectCurrency(null)}
                  testID="market-filter-currency-all"
                  styles={styles}
                />
                {currencies.map((cur) => (
                  <Chip
                    key={cur}
                    // Sats read as the app's lower-case "sats" unit; fiat
                    // stays as its ISO code (EUR, GBP …).
                    label={cur === SATS_CURRENCY_CODE ? t('market.filters.satsChip') : cur}
                    selected={selectedCurrency === cur}
                    onPress={() => onSelectCurrency(selectedCurrency === cur ? null : cur)}
                    testID={`market-filter-currency-${cur}`}
                    styles={styles}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>

        <TouchableOpacity
          style={styles.doneButton}
          onPress={onClose}
          accessibilityLabel={t('market.filters.close')}
          testID="market-filter-done"
          activeOpacity={0.8}
        >
          <Text style={styles.doneText}>{t('market.filters.done')}</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
};

export default MarketFilterBar;
