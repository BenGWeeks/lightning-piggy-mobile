import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Check, Lock } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createMarketModeSelectorStyles } from '../styles/MarketModeSelector.styles';
import { MARKET_MODE_OPTIONS, type MarketMode } from '../utils/marketMode';

interface Props {
  /** Currently selected marketplace mode. */
  value: MarketMode;
  /** Called with the new mode when an ENABLED chip is tapped. Disabled
   * chips ("coming soon") never fire this. */
  onChange: (mode: MarketMode) => void;
}

/**
 * Horizontal mode selector for the Market section. Lets the user choose
 * which set of sellers products are sourced from:
 *   • Lightning Piggy Preferred Sellers (default, active)
 *   • WoT: Friends (active)
 *   • WoT: Friends of Friends (disabled — coming soon)
 *   • WoT: All (disabled — coming soon)
 *
 * The two disabled options render visibly greyed with a lock + "Soon" tag
 * and are non-selectable (per the design ask, present-but-disabled rather
 * than hidden), so the roadmap is discoverable.
 */
const MarketModeSelector: React.FC<Props> = ({ value, onChange }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createMarketModeSelectorStyles(colors), [colors]);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      testID="market-mode-selector"
    >
      {MARKET_MODE_OPTIONS.map((opt) => {
        const selected = opt.mode === value;
        const disabled = !opt.enabled;
        const chipStyle = [
          styles.chip,
          selected && styles.chipSelected,
          disabled && styles.chipDisabled,
        ];
        const textStyle = [
          styles.chipText,
          selected && styles.chipTextSelected,
          disabled && styles.chipTextDisabled,
        ];
        return (
          <TouchableOpacity
            key={opt.mode}
            style={chipStyle}
            onPress={() => {
              if (!disabled) onChange(opt.mode);
            }}
            disabled={disabled}
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={
              disabled
                ? t('market.modes.comingSoon', { label: opt.label })
                : selected
                  ? t('market.modes.selected', { label: opt.label })
                  : opt.label
            }
            testID={`market-mode-${opt.mode}`}
            activeOpacity={disabled ? 1 : 0.7}
          >
            {selected && !disabled ? (
              <Check size={13} color={colors.white} strokeWidth={3} />
            ) : null}
            {disabled ? (
              <Lock size={11} color={colors.textSupplementary} strokeWidth={2.25} />
            ) : null}
            <Text style={textStyle} numberOfLines={1}>
              {opt.label}
            </Text>
            {disabled ? (
              <View style={styles.soonPill} testID={`market-mode-${opt.mode}-soon`}>
                <Text style={styles.soonText}>{t('market.modes.soon')}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
};

export default MarketModeSelector;
