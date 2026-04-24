import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Sun, Moon, Smartphone, Check } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { createSharedAccountStyles } from './sharedStyles';
import { useTheme } from '../../contexts/ThemeContext';
import type { Palette, ThemePreference } from '../../styles/palettes';

const AppearanceScreen: React.FC = () => {
  const { colors, preference, setPreference } = useTheme();
  const sharedAccountStyles = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createStyles(colors), [colors]);

  const options: {
    value: ThemePreference;
    label: string;
    description: string;
    icon: React.ReactNode;
  }[] = [
    {
      value: 'system',
      label: 'System',
      description: 'Follow your device setting',
      icon: <Smartphone size={20} color={colors.white} />,
    },
    {
      value: 'light',
      label: 'Light',
      description: 'Always light theme',
      icon: <Sun size={20} color={colors.white} />,
    },
    {
      value: 'dark',
      label: 'Dark',
      description: 'Always dark theme',
      icon: <Moon size={20} color={colors.white} />,
    },
  ];

  return (
    <AccountScreenLayout title="Appearance">
      <Text style={sharedAccountStyles.sectionLabel}>Theme</Text>
      <View style={styles.optionList}>
        {options.map((opt) => {
          const selected = preference === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[styles.optionRow, selected && styles.optionRowSelected]}
              onPress={() => setPreference(opt.value)}
              accessibilityLabel={`${opt.label} theme`}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              testID={`appearance-${opt.value}`}
            >
              <View style={styles.optionIcon}>{opt.icon}</View>
              <View style={styles.optionMain}>
                <Text style={styles.optionLabel}>{opt.label}</Text>
                <Text style={styles.optionDescription}>{opt.description}</Text>
              </View>
              {selected && <Check size={20} color={colors.white} />}
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={sharedAccountStyles.fieldHint}>
        Affects every screen in the app. "System" follows your device's light/dark setting and
        switches automatically when it changes.
      </Text>
    </AccountScreenLayout>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    optionList: {
      gap: 8,
    },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 12,
      backgroundColor: 'rgba(255,255,255,0.1)',
      borderWidth: 2,
      borderColor: 'transparent',
    },
    optionRowSelected: {
      borderColor: colors.white,
      backgroundColor: 'rgba(255,255,255,0.2)',
    },
    optionIcon: {
      width: 28,
      alignItems: 'center',
    },
    optionMain: {
      flex: 1,
    },
    optionLabel: {
      color: colors.white,
      fontSize: 15,
      fontWeight: '700',
    },
    optionDescription: {
      color: colors.white,
      fontSize: 12,
      opacity: 0.7,
      marginTop: 2,
    },
  });

export default AppearanceScreen;
