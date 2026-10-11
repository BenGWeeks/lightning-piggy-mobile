import React, { useMemo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { createSettingsOptionListStyles } from '../styles/SettingsOptionList.styles';

export interface SettingsOption<T extends string> {
  value: T;
  label: string;
  description: string;
  icon: React.ReactNode;
  /** Screen-reader label for the row. */
  a11yLabel: string;
}

interface Props<T extends string> {
  options: SettingsOption<T>[];
  selected: T;
  onSelect: (value: T) => void;
  /** Row testID is `${testIDPrefix}-${value}`; the tick is `…-check`. */
  testIDPrefix: string;
}

/**
 * A single-choice list of settings rows (icon, label, description, tick on
 * the selected one) — Theme, Sending animation and Language all use it.
 */
function SettingsOptionList<T extends string>({
  options,
  selected,
  onSelect,
  testIDPrefix,
}: Props<T>) {
  const colors = useThemeColors();
  const styles = useMemo(() => createSettingsOptionListStyles(colors), [colors]);
  return (
    <View style={styles.optionList}>
      {options.map((opt) => {
        const isSelected = selected === opt.value;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[styles.optionRow, isSelected && styles.optionRowSelected]}
            onPress={() => onSelect(opt.value)}
            accessibilityLabel={opt.a11yLabel}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            testID={`${testIDPrefix}-${opt.value}`}
          >
            <View style={styles.optionIcon}>{opt.icon}</View>
            <View style={styles.optionMain}>
              <Text style={styles.optionLabel}>{opt.label}</Text>
              <Text style={styles.optionDescription}>{opt.description}</Text>
            </View>
            {isSelected && (
              <View testID={`${testIDPrefix}-${opt.value}-check`}>
                <Check size={20} color={colors.white} />
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default SettingsOptionList;
