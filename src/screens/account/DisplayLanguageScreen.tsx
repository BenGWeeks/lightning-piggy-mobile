import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ChevronRight, Droplets, Globe, Moon, Smartphone, Sun, Zap } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { createSharedAccountStyles } from './sharedStyles';
import SettingsScopeHeader from '../../components/SettingsScopeHeader';
import SettingsOptionList, { type SettingsOption } from '../../components/SettingsOptionList';
import { useTheme } from '../../contexts/ThemeContext';
import { useWallet } from '../../contexts/WalletContext';
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
import { CURRENCY_LIST } from '../../services/fiatService';
import { createDisplayLanguageScreenStyles } from '../../styles/DisplayLanguageScreen.styles';
import type { ThemePreference } from '../../styles/palettes';
import type { AccountDrawerNavigation } from '../../navigation/types';

// Display names for the locale picker. Keep in sync with SUPPORTED_LOCALES
// in src/i18n — each new language batch adds one entry. Shown in their own
// language so a user stuck in the wrong one can still find theirs.
const LOCALE_LABELS: Record<(typeof SUPPORTED_LOCALES)[number], string> = {
  en: 'English',
  es: 'Español',
  uk: 'Українська',
};

/**
 * Settings → Display & language: Currency, Language, Theme and Sending
 * animation on one screen (formerly three). Currency and Language are under
 * "For this account"; Theme and Sending animation under "On this phone".
 * The 38-currency picker stays its own screen (`AccountCurrency`), reached
 * from the Currency row.
 */
const DisplayLanguageScreen: React.FC = () => {
  const { colors, preference: themePreference, setPreference: setThemePreference } = useTheme();
  const t = useTranslation();
  const navigation = useNavigation<AccountDrawerNavigation>();
  const shared = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createDisplayLanguageScreenStyles(colors), [colors]);
  const { currency } = useWallet();
  const {
    preference: localePreference,
    setPreference: setLocalePreference,
    locale: resolvedLocale,
  } = useLocale();
  const { preference: sendingAnimation, setPreference: setSendingAnimation } =
    useSendingAnimation();

  const currencyName = CURRENCY_LIST.find((c) => c.code === currency)?.name ?? '';

  const localeOptions = useMemo<SettingsOption<LocalePreference>[]>(() => {
    const options: SettingsOption<LocalePreference>[] = [
      {
        value: 'system',
        label: t('appearanceScreen.system'),
        description: t('languageScreen.systemDesc'),
        icon: <Smartphone size={20} color={colors.white} />,
        a11yLabel: t('languageScreen.a11y', { label: t('appearanceScreen.system') }),
      },
    ];
    for (const code of SUPPORTED_LOCALES) {
      options.push({
        value: code,
        label: LOCALE_LABELS[code],
        description: t('languageScreen.alwaysLanguage', { language: LOCALE_LABELS[code] }),
        icon: <Globe size={20} color={colors.white} />,
        a11yLabel: t('languageScreen.a11y', { label: LOCALE_LABELS[code] }),
      });
    }
    return options;
  }, [colors, t]);

  const themeOptions = useMemo<SettingsOption<ThemePreference>[]>(
    () =>
      (
        [
          ['system', 'appearanceScreen.system', 'appearanceScreen.themeSystemDesc', Smartphone],
          ['light', 'appearanceScreen.themeLight', 'appearanceScreen.themeLightDesc', Sun],
          ['dark', 'appearanceScreen.themeDark', 'appearanceScreen.themeDarkDesc', Moon],
        ] as const
      ).map(([value, labelKey, descKey, Icon]) => ({
        value,
        label: t(labelKey),
        description: t(descKey),
        icon: <Icon size={20} color={colors.white} />,
        a11yLabel: t('appearanceScreen.themeA11y', { label: t(labelKey) }),
      })),
    [colors, t],
  );

  const animationOptions = useMemo<SettingsOption<SendingAnimationPreference>[]>(
    () =>
      (
        [
          ['bubbles', 'appearanceScreen.animBubbles', 'appearanceScreen.animBubblesDesc', Droplets],
          [
            'lightning',
            'appearanceScreen.animLightning',
            'appearanceScreen.animLightningDesc',
            Zap,
          ],
        ] as const
      ).map(([value, labelKey, descKey, Icon]) => ({
        value,
        label: t(labelKey),
        description: t(descKey),
        icon: <Icon size={20} color={colors.white} />,
        a11yLabel: t('appearanceScreen.animationA11y', { label: t(labelKey) }),
      })),
    [colors, t],
  );

  return (
    <AccountScreenLayout title={t('displayLanguageScreen.title')}>
      <SettingsScopeHeader scope="account" testID="display-language-account" />

      <Text style={[shared.sectionLabel, styles.sectionGap]}>{t('displayScreen.currency')}</Text>
      <TouchableOpacity
        style={styles.currencyRow}
        onPress={() => navigation.navigate('AccountCurrency')}
        accessibilityRole="button"
        accessibilityLabel={t('displayLanguageScreen.currencyRowA11y', {
          code: currency,
          name: currencyName,
        })}
        testID="display-language-currency-row"
      >
        <View style={styles.currencyText}>
          <Text style={styles.currencyCode}>{currency}</Text>
          <Text style={styles.currencyName} numberOfLines={1}>
            {currencyName}
          </Text>
        </View>
        <Text style={styles.changeText}>{t('displayLanguageScreen.change')}</Text>
        <ChevronRight size={18} color={colors.white} />
      </TouchableOpacity>

      <Text style={[shared.sectionLabel, styles.sectionGap]}>
        {t('languageScreen.sectionLabel')}
      </Text>
      <SettingsOptionList
        options={localeOptions}
        selected={localePreference}
        onSelect={setLocalePreference}
        testIDPrefix="locale"
      />
      <Text style={shared.fieldHint}>
        {t('languageScreen.hint', { language: LOCALE_LABELS[resolvedLocale] })}
      </Text>

      <SettingsScopeHeader scope="phone" spaced testID="display-language-phone" />

      <Text style={[shared.sectionLabel, styles.sectionGap]}>
        {t('appearanceScreen.themeSectionLabel')}
      </Text>
      <SettingsOptionList
        options={themeOptions}
        selected={themePreference}
        onSelect={setThemePreference}
        testIDPrefix="appearance"
      />
      <Text style={shared.fieldHint}>{t('appearanceScreen.themeHint')}</Text>

      <Text style={[shared.sectionLabel, styles.sectionGap]}>
        {t('appearanceScreen.animationSectionLabel')}
      </Text>
      <SettingsOptionList
        options={animationOptions}
        selected={sendingAnimation}
        onSelect={setSendingAnimation}
        testIDPrefix="sending-animation"
      />
      <Text style={shared.fieldHint}>{t('appearanceScreen.animationHint')}</Text>
    </AccountScreenLayout>
  );
};

export default DisplayLanguageScreen;
