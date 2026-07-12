import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Smartphone, Check, Globe } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { createSharedAccountStyles } from './sharedStyles';
import { useThemeColors } from '../../contexts/ThemeContext';
import {
  useLocale,
  useTranslation,
  SUPPORTED_LOCALES,
  type LocalePreference,
} from '../../contexts/LocaleContext';
import { createLanguageScreenStyles } from '../../styles/LanguageScreen.styles';

// #137: display names for the locale picker. Keep this in sync with
// SUPPORTED_LOCALES in src/i18n — each new language batch adds one entry.
// Moved verbatim from AppearanceScreen (#1058) — Language is now its own
// top-level account section instead of living inside Appearance.
const LOCALE_LABELS: Record<(typeof SUPPORTED_LOCALES)[number], string> = {
  en: 'English',
  es: 'Español',
  uk: 'Українська',
};

const LanguageScreen: React.FC = () => {
  const colors = useThemeColors();
  const t = useTranslation();
  const {
    preference: localePreference,
    setPreference: setLocalePreference,
    locale: resolvedLocale,
  } = useLocale();
  const sharedAccountStyles = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createLanguageScreenStyles(colors), [colors]);

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
        // Shares appearanceScreen.system with the Theme picker's "System"
        // option — same word, same key, on purpose (avoids duplicating an
        // identical translation across two screens' catalogues).
        label: t('appearanceScreen.system'),
        description: t('languageScreen.systemDesc'),
        icon: <Smartphone size={20} color={colors.white} />,
      },
      ...SUPPORTED_LOCALES.map((code) => ({
        value: code,
        label: LOCALE_LABELS[code],
        description: t('languageScreen.alwaysLanguage', { language: LOCALE_LABELS[code] }),
        icon: <Globe size={20} color={colors.white} />,
      })),
    ],
    [colors, t],
  );

  return (
    <AccountScreenLayout title={t('languageScreen.title')}>
      <Text style={sharedAccountStyles.sectionLabel}>{t('languageScreen.sectionLabel')}</Text>
      <View style={styles.optionList}>
        {localeOptions.map((opt) => {
          const selected = localePreference === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[styles.optionRow, selected && styles.optionRowSelected]}
              onPress={() => setLocalePreference(opt.value)}
              accessibilityLabel={t('languageScreen.a11y', { label: opt.label })}
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
        {t('languageScreen.hint', { language: LOCALE_LABELS[resolvedLocale] })}
      </Text>
    </AccountScreenLayout>
  );
};

export default LanguageScreen;
