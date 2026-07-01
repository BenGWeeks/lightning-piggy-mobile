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
import { X } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { createMarketFilterBarStyles } from '../styles/MarketFilterBar.styles';
import { vendorSlug } from '../utils/marketVendors';

interface Props {
  /** Whether the filter panel is open. */
  visible: boolean;
  /** Close the panel (backdrop tap, Done, or Android back). */
  onClose: () => void;
  /** Distinct merchants present in the data; `null` selection means "All". */
  merchants: string[];
  selectedMerchant: string | null;
  onSelectMerchant: (merchant: string | null) => void;
  /** Distinct countries present in the data; `null` selection means "All". */
  countries: string[];
  selectedCountry: string | null;
  onSelectCountry: (country: string | null) => void;
  /** Distinct currencies present in the data; `null` selection means "All". */
  currencies: string[];
  selectedCurrency: string | null;
  onSelectCurrency: (currency: string | null) => void;
  /** Whether any category axis is active — shows the Clear affordance. */
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
}> = ({ label, selected, onPress, testID, styles }) => (
  <TouchableOpacity
    style={[styles.chip, selected && styles.chipSelected]}
    onPress={onPress}
    accessibilityState={{ selected }}
    accessibilityLabel={`${label}${selected ? ', selected' : ''}`}
    testID={testID}
    activeOpacity={0.7}
  >
    <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>
      {label}
    </Text>
  </TouchableOpacity>
);

/**
 * Right-anchored, slide-in **filter panel** for the Market screen.
 *
 * Houses the merchant / country / currency filter controls so the main view
 * stays compact — the header keeps only the inline search box plus a filter
 * icon that opens this panel. The chip axes are sourced from the DISTINCT
 * values present in the loaded products (passed in by the screen) rather than
 * hardcoded, so they stay correct as the catalogue changes; each section leads
 * with an "All" chip that clears that axis. Selections apply LIVE to the grid
 * behind the panel (no Apply step), so "Done" simply closes it. A "Clear
 * filters" row resets every category axis at once and only shows while one is
 * active.
 *
 * Presentational only — no filtering logic lives here (that's the pure
 * `utils/marketFilters` module); this just renders controls and reports
 * selections up. The panel slides in from the right over a tap-to-dismiss
 * backdrop.
 */
const MarketFilterBar: React.FC<Props> = ({
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
        if (finished) setRendered(false);
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
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="market-filter-backdrop" />
      <Animated.View
        style={[styles.panel, { width: panelWidth, transform: [{ translateX }] }]}
        testID="market-filter-panel"
      >
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>Filters</Text>
          {active ? (
            <TouchableOpacity
              onPress={onClear}
              accessibilityLabel="Clear all filters"
              testID="market-filter-clear"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.clearText}>Clear filters</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={onClose}
            accessibilityLabel="Close filters"
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
          {/* Merchant */}
          {merchants.length > 0 ? (
            <View style={styles.section} testID="market-filter-merchants">
              <Text style={styles.sectionLabel}>Merchant</Text>
              <View style={styles.chipWrap}>
                <Chip
                  label="All"
                  selected={selectedMerchant === null}
                  onPress={() => onSelectMerchant(null)}
                  testID="market-filter-merchant-all"
                  styles={styles}
                />
                {merchants.map((m) => (
                  <Chip
                    key={m}
                    label={m}
                    selected={selectedMerchant === m}
                    onPress={() => onSelectMerchant(selectedMerchant === m ? null : m)}
                    // Slugify the merchant name so the testID has no spaces
                    // (e.g. "Danish Bacon" -> "danish-bacon"), keeping Maestro
                    // selectors stable — matching the codebase's filter-chip
                    // convention.
                    testID={`market-filter-merchant-${vendorSlug(m)}`}
                    styles={styles}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {/* Country */}
          {countries.length > 0 ? (
            <View style={styles.section} testID="market-filter-countries">
              <Text style={styles.sectionLabel}>Country</Text>
              <View style={styles.chipWrap}>
                <Chip
                  label="All"
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
              <Text style={styles.sectionLabel}>Currency</Text>
              <View style={styles.chipWrap}>
                <Chip
                  label="All"
                  selected={selectedCurrency === null}
                  onPress={() => onSelectCurrency(null)}
                  testID="market-filter-currency-all"
                  styles={styles}
                />
                {currencies.map((cur) => (
                  <Chip
                    key={cur}
                    label={cur}
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
          accessibilityLabel="Close filters"
          testID="market-filter-done"
          activeOpacity={0.8}
        >
          <Text style={styles.doneText}>Done</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
};

export default MarketFilterBar;
