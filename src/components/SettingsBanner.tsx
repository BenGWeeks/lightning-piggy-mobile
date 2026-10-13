import React, { useMemo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { createSettingsBannerStyles } from '../styles/SettingsBanner.styles';

interface Props {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  testID: string;
  subtitleTestID?: string;
  accessibilityLabel?: string;
  action?: {
    label: string;
    onPress: () => void;
    testID: string;
    disabled?: boolean;
    busy?: boolean;
  };
}

/** Presentation only: permission checks and actions remain with the caller. */
export default function SettingsBanner({
  icon: Icon,
  title,
  subtitle,
  testID,
  subtitleTestID,
  accessibilityLabel,
  action,
}: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createSettingsBannerStyles(colors), [colors]);
  return (
    <View
      style={styles.banner}
      testID={testID}
      accessibilityRole="alert"
      accessibilityLabel={accessibilityLabel ?? `${title}: ${subtitle}`}
    >
      <Icon size={22} color={colors.brandPink} />
      <View style={styles.bannerText}>
        <Text style={styles.bannerTitle}>{title}</Text>
        <Text style={styles.bannerStatus} testID={subtitleTestID}>
          {subtitle}
        </Text>
      </View>
      {action && (
        <TouchableOpacity
          style={styles.bannerButton}
          hitSlop={{ top: 6, bottom: 6 }}
          onPress={action.onPress}
          disabled={action.disabled || action.busy}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityState={{ disabled: !!action.disabled || !!action.busy, busy: !!action.busy }}
          testID={action.testID}
        >
          <Text style={styles.bannerButtonText}>{action.label}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
