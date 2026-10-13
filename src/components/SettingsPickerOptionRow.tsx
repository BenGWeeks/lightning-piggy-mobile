import React, { useMemo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Circle, CircleDot } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { createPickerScreenStyles } from '../styles/PickerScreen.styles';
import type { SettingsPickerOption } from '../utils/settingsPicker';

/** Shared by the full screen and the bounded segmented fallback sheet. */
export default React.memo(function SettingsPickerOptionRow({
  option,
  selected,
  onSelect,
  testID,
}: {
  option: SettingsPickerOption;
  selected: boolean;
  onSelect: (value: string) => void;
  testID: string;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => createPickerScreenStyles(colors), [colors]);
  const Icon = selected ? CircleDot : Circle;
  return (
    <TouchableOpacity
      style={[styles.row, option.disabled && styles.disabled]}
      onPress={() => onSelect(option.value)}
      disabled={option.disabled}
      testID={option.testID ?? testID}
      accessibilityRole="radio"
      accessibilityLabel={option.subtitle ? `${option.label}: ${option.subtitle}` : option.label}
      accessibilityState={{ checked: selected, disabled: !!option.disabled }}
    >
      <Icon size={22} color={colors.accentSecondary} />
      <View style={styles.text}>
        <Text style={styles.label}>{option.label}</Text>
        {option.subtitle && <Text style={styles.subtitle}>{option.subtitle}</Text>}
      </View>
    </TouchableOpacity>
  );
});
