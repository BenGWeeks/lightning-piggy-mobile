import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Sun, Moon, Smartphone, Check, Zap, Droplets, Globe } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { createSharedAccountStyles } from './sharedStyles';
import { useTheme } from '../../contexts/ThemeContext';
import {
  useLocale,
  useTranslation,
  SUPPORTED_LOCALES,
  type LocalePreference,
} from '../../contexts/LocaleContext';
import {
  useSendingAnimation,
  type SendingAnimationPreference,
} from '../../contexts/SendingAnimationContext';
import { createAppearanceScreenStyles } from '../../styles/AppearanceScreen.styles';
import type { ThemePreference } from '../../styles/palettes';

// #137: display names for the locale picker. Keep this in sync with
// SUPPORTED_LOCALES in src/i18n — each new language batch adds one entry.
const LOCALE_LABELS: Record<(typeof SUPPORTED_LOCALES)[number], string> = {
  en: 'English',
  es: 'Español',
};

const AppearanceScreen: React.FC = () => {
  const { colors, preference, setPreference } = useTheme();
  const t = useTranslation();
  const {
    preference: localePreference,
    setPreference: setLocalePreference,
    locale: resolvedLocale,
  } = useLocale();
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

  const localeOptions = useMemo<
    {
      value: LocalePreference;
      label: string;
      description: string;
      icon: React.ReactNode;
    }[]
  >(
    () => [
      {
        value: 'system',
        label: t('appearanceScreen.system'),
        description: t('appearanceScreen.localeSystemDesc'),
        icon: <Smartphone size={20} color={colors.white} />,
      },
      ...SUPPORTED_LOCALES.map((code) => ({
        value: code,
        label: LOCALE_LABELS[code],
        description: t('appearanceScreen.alwaysLanguage', { language: LOCALE_LABELS[code] }),
        icon: <Globe size={20} color={colors.white} />,
      })),
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
          {t('appearanceScreen.languageSectionLabel')}
        </Text>
        <View style={styles.optionList}>
          {localeOptions.map((opt) => {
            const selected = localePreference === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.optionRow, selected && styles.optionRowSelected]}
                onPress={() => setLocalePreference(opt.value)}
                accessibilityLabel={t('appearanceScreen.languageA11y', { label: opt.label })}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                testID={`locale-${opt.value}`}
              >
                <View style={styles.optionIcon}>{opt.icon}</View>
                <View style={styles.optionMain}>
                  <Text style={styles.optionLabel}>{opt.label}</Text>
                  <Text style={styles.optionDescription}>{opt.description}</Text>
                </View>
                {selected && (
                  <View testID={`locale-${opt.value}-check`}>
                    <Check size={20} color={colors.white} />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={sharedAccountStyles.fieldHint}>
          {t('appearanceScreen.languageHint', { language: LOCALE_LABELS[resolvedLocale] })}
        </Text>
      </View>

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
