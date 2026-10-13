import React, { useContext, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { SettingsSectionCardContext } from '../contexts/SettingsSectionCardContext';
import { createSegmentedRowStyles } from '../styles/SegmentedRow.styles';
import { shouldUseSegmentedPicker, type SettingsPickerOption } from '../utils/settingsPicker';
import SettingsRow from './SettingsRow';
import SettingsInfoSheet from './SettingsInfoSheet';
import SettingsPickerOptionRow from './SettingsPickerOptionRow';

interface Props {
  icon: LucideIcon;
  title: string;
  options:
    | readonly [SettingsPickerOption]
    | readonly [SettingsPickerOption, SettingsPickerOption]
    | readonly [SettingsPickerOption, SettingsPickerOption, SettingsPickerOption];
  value: string;
  onValueChange: (value: string) => void;
  testID: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  disabledSubtitle?: string;
}

/** Controlled presentation: selecting never saves or publishes on its own. */
export default function SegmentedRow({
  icon: Icon,
  title,
  options,
  value,
  onValueChange,
  testID,
  accessibilityLabel,
  disabled = false,
  disabledSubtitle,
}: Props) {
  const grouped = useContext(SettingsSectionCardContext);
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createSegmentedRowStyles(colors), [colors]);
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const [measurements, setMeasurements] = useState<{
    key: string;
    overflow: Record<string, boolean>;
  }>({ key: '', overflow: {} });
  const [open, setOpen] = useState(false);
  const measureKey = JSON.stringify([width, fontScale, options.map((option) => option.label)]);
  const overflow =
    measurements.key === measureKey && Object.values(measurements.overflow).some(Boolean);
  const fallback = shouldUseSegmentedPicker(options.length, fontScale, overflow);
  const selected = options.find((option) => option.value === value);
  const select = (next: string) => {
    setOpen(false);
    onValueChange(next);
  };
  return (
    <View
      testID={`${testID}-container`}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {/* Measure translated labels at their real slot width even while showing the fallback. */}
      {width > 0 &&
        options.length <= 3 &&
        options.map((option, index) => (
          <Text
            key={`${measureKey}-${index}`}
            style={[
              styles.label,
              styles.measure,
              {
                width: Math.max(
                  1,
                  (width - 28 - Math.max(0, options.length - 1) * 4) / options.length - 16,
                ),
              },
            ]}
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            onTextLayout={(event) => {
              const over = event.nativeEvent.lines.length > 1;
              setMeasurements((previous) => {
                const current = previous.key === measureKey ? previous.overflow : {};
                if (previous.key === measureKey && current[index] === over) return previous;
                return { key: measureKey, overflow: { ...current, [index]: over } };
              });
            }}
          >
            {option.label}
          </Text>
        ))}
      {fallback ? (
        <SettingsRow
          icon={Icon}
          title={title}
          value={selected?.label ?? t('settingsKit.status.unknown')}
          testID={testID}
          accessibilityLabel={accessibilityLabel}
          onPress={() => setOpen(true)}
          disabled={disabled}
          disabledSubtitle={disabledSubtitle}
        />
      ) : (
        <View
          style={[styles.container, grouped && styles.grouped, disabled && styles.disabled]}
          testID={testID}
        >
          <View style={styles.heading}>
            <Icon size={22} color={colors.white} />
            <Text style={styles.title}>{title}</Text>
          </View>
          <View
            style={styles.segments}
            accessibilityRole="radiogroup"
            accessibilityLabel={accessibilityLabel ?? title}
          >
            {options.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.segment,
                  option.value === value && styles.selected,
                  option.disabled && styles.disabled,
                ]}
                onPress={() => onValueChange(option.value)}
                disabled={disabled || option.disabled}
                testID={option.testID ?? `${testID}-option-${option.value}`}
                accessibilityRole="radio"
                accessibilityLabel={`${title}: ${option.label}`}
                accessibilityState={{
                  checked: value === option.value,
                  disabled: disabled || !!option.disabled,
                }}
              >
                <Text style={styles.label}>{option.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
      <SettingsInfoSheet
        visible={open && !disabled}
        onClose={() => setOpen(false)}
        title={title}
        testID={`${testID}-picker`}
      >
        {options.map((option) => (
          <SettingsPickerOptionRow
            key={option.value}
            option={option}
            selected={option.value === value}
            onSelect={select}
            testID={`${testID}-picker-option-${option.value}`}
          />
        ))}
      </SettingsInfoSheet>
    </View>
  );
}
