import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Sun, Moon, Smartphone, Check, Zap, Droplets } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { createSharedAccountStyles } from './sharedStyles';
import { useTheme } from '../../contexts/ThemeContext';
import {
  useSendingAnimation,
  type SendingAnimationPreference,
} from '../../contexts/SendingAnimationContext';
import { createAppearanceScreenStyles } from '../../styles/AppearanceScreen.styles';
import type { ThemePreference } from '../../styles/palettes';

const AppearanceScreen: React.FC = () => {
  const { colors, preference, setPreference } = useTheme();
  const { preference: sendingAnimation, setPreference: setSendingAnimation } =
    useSendingAnimation();
  const sharedAccountStyles = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createAppearanceScreenStyles(colors), [colors]);

  const themeOptions = useMemo<
    {
      value: ThemePreference;
      label: string;
      description: string;
      icon: React.ReactNode;
    }[]
  >(
    () => [
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
    ],
    [colors],
  );

  const sendingAnimationOptions = useMemo<
    {
      value: SendingAnimationPreference;
      label: string;
      description: string;
      icon: React.ReactNode;
    }[]
  >(
    () => [
      {
        value: 'bubbles',
        label: 'Bubbles',
        description: 'Rising bubbles while sending',
        icon: <Droplets size={20} color={colors.white} />,
      },
      {
        value: 'lightning',
        label: 'Lightning',
        description: 'Crackling bolts while sending',
        icon: <Zap size={20} color={colors.white} />,
      },
    ],
    [colors],
  );

  return (
    <AccountScreenLayout title="Appearance">
      <Text style={sharedAccountStyles.sectionLabel}>Theme</Text>
      <View style={styles.optionList}>
        {themeOptions.map((opt) => {
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
              {selected && (
                <View testID={`appearance-${opt.value}-check`}>
                  <Check size={20} color={colors.white} />
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={sharedAccountStyles.fieldHint}>
        Affects every screen in the app. "System" follows your device's light/dark setting and
        switches automatically when it changes.
      </Text>

      <View style={styles.section}>
        <Text style={sharedAccountStyles.sectionLabel}>Sending animation</Text>
        <View style={styles.optionList}>
          {sendingAnimationOptions.map((opt) => {
            const selected = sendingAnimation === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.optionRow, selected && styles.optionRowSelected]}
                onPress={() => setSendingAnimation(opt.value)}
                accessibilityLabel={`${opt.label} sending animation`}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                testID={`sending-animation-${opt.value}`}
              >
                <View style={styles.optionIcon}>{opt.icon}</View>
                <View style={styles.optionMain}>
                  <Text style={styles.optionLabel}>{opt.label}</Text>
                  <Text style={styles.optionDescription}>{opt.description}</Text>
                </View>
                {selected && (
                  <View testID={`sending-animation-${opt.value}-check`}>
                    <Check size={20} color={colors.white} />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={sharedAccountStyles.fieldHint}>
          The animation shown while a payment is being sent. Both fade from purple to green when the
          payment succeeds.
        </Text>
      </View>
    </AccountScreenLayout>
  );
};

export default AppearanceScreen;
