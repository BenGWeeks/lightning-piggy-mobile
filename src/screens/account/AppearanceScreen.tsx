import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Sun, Moon, Smartphone, Check, Zap, Droplets } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { createSharedAccountStyles } from './sharedStyles';
import { useTheme } from '../../contexts/ThemeContext';
import { useTranslation } from '../../contexts/LocaleContext';
import {
  useSendingAnimation,
  type SendingAnimationPreference,
} from '../../contexts/SendingAnimationContext';
import { createAppearanceScreenStyles } from '../../styles/AppearanceScreen.styles';
import type { ThemePreference } from '../../styles/palettes';

const AppearanceScreen: React.FC = () => {
  const { colors, preference, setPreference } = useTheme();
  const t = useTranslation();
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
        label: t('appearanceScreen.system'),
        description: t('appearanceScreen.themeSystemDesc'),
        icon: <Smartphone size={20} color={colors.white} />,
      },
      {
        value: 'light',
        label: t('appearanceScreen.themeLight'),
        description: t('appearanceScreen.themeLightDesc'),
        icon: <Sun size={20} color={colors.white} />,
      },
      {
        value: 'dark',
        label: t('appearanceScreen.themeDark'),
        description: t('appearanceScreen.themeDarkDesc'),
        icon: <Moon size={20} color={colors.white} />,
      },
    ],
    [colors, t],
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
        label: t('appearanceScreen.animBubbles'),
        description: t('appearanceScreen.animBubblesDesc'),
        icon: <Droplets size={20} color={colors.white} />,
      },
      {
        value: 'lightning',
        label: t('appearanceScreen.animLightning'),
        description: t('appearanceScreen.animLightningDesc'),
        icon: <Zap size={20} color={colors.white} />,
      },
    ],
    [colors, t],
  );

  return (
    <AccountScreenLayout title={t('appearanceScreen.title')}>
      <Text style={sharedAccountStyles.sectionLabel}>
        {t('appearanceScreen.themeSectionLabel')}
      </Text>
      <View style={styles.optionList}>
        {themeOptions.map((opt) => {
          const selected = preference === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[styles.optionRow, selected && styles.optionRowSelected]}
              onPress={() => setPreference(opt.value)}
              accessibilityLabel={t('appearanceScreen.themeA11y', { label: opt.label })}
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
      <Text style={sharedAccountStyles.fieldHint}>{t('appearanceScreen.themeHint')}</Text>

      <View style={styles.section}>
        <Text style={sharedAccountStyles.sectionLabel}>
          {t('appearanceScreen.animationSectionLabel')}
        </Text>
        <View style={styles.optionList}>
          {sendingAnimationOptions.map((opt) => {
            const selected = sendingAnimation === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.optionRow, selected && styles.optionRowSelected]}
                onPress={() => setSendingAnimation(opt.value)}
                accessibilityLabel={t('appearanceScreen.animationA11y', { label: opt.label })}
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
        <Text style={sharedAccountStyles.fieldHint}>{t('appearanceScreen.animationHint')}</Text>
      </View>
    </AccountScreenLayout>
  );
};

export default AppearanceScreen;
