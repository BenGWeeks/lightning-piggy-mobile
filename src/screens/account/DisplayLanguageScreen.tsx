import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { Droplets, Globe, Moon, CircleDollarSign } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import SettingsSection from '../../components/SettingsSection';
import SettingsRow from '../../components/SettingsRow';
import SegmentedRow from '../../components/SegmentedRow';
import { useTheme } from '../../contexts/ThemeContext';
import { useWallet } from '../../contexts/WalletContext';
import { useNostr } from '../../contexts/NostrContext';
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
import { PSEUDO_LOCALE, isPseudoLocaleAvailable } from '../../utils/pseudoLocale';
import { useSettingsPicker } from '../../hooks/useSettingsPicker';
import type { ThemePreference } from '../../styles/palettes';
import type { AccountDrawerNavigation } from '../../navigation/types';

export default function DisplayLanguageScreen() {
  const { preference: themePreference, setPreference: setThemePreference } = useTheme();
  const t = useTranslation();
  const navigation = useNavigation<AccountDrawerNavigation>();
  const { pubkey } = useNostr();
  const { currency } = useWallet();
  const { preference: localePreference, setPreference: setLocalePreference, locale } = useLocale();
  const { preference: sendingAnimation, setPreference: setSendingAnimation } =
    useSendingAnimation();
  const openPicker = useSettingsPicker(pubkey, (value) =>
    setLocalePreference(value as LocalePreference),
  );
  const languageName =
    localePreference === PSEUDO_LOCALE
      ? t('settingsScreens.pseudoLanguage')
      : t(`settingsScreens.languages.${locale}`);
  const localeOptions = [
    {
      value: 'system',
      label: t('appearanceScreen.system'),
      subtitle: t('languageScreen.systemDesc'),
      testID: 'locale-system',
    },
    ...SUPPORTED_LOCALES.map((value) => ({
      value,
      label: t(`settingsScreens.languages.${value}`),
      testID: `locale-${value}`,
    })),
    ...(isPseudoLocaleAvailable()
      ? [
          {
            value: PSEUDO_LOCALE,
            label: t('settingsScreens.pseudoLanguage'),
            testID: `locale-${PSEUDO_LOCALE}`,
          },
        ]
      : []),
  ];
  const currencyName = CURRENCY_LIST.find((c) => c.code === currency)?.name ?? '';
  return (
    <AccountScreenLayout title={t('displayLanguageScreen.title')}>
      <SettingsSection scope="account" testID="display-language-account">
        <SettingsRow
          icon={CircleDollarSign}
          title={t('displayScreen.currency')}
          value={t('settingsScreens.currencyValue', { code: currency, name: currencyName })}
          testID="display-language-currency-row"
          accessibilityLabel={t('displayLanguageScreen.currencyRowA11y', {
            code: currency,
            name: currencyName,
          })}
          onPress={() => navigation.navigate('AccountCurrency')}
        />
        <SettingsRow
          icon={Globe}
          title={t('languageScreen.sectionLabel')}
          value={
            localePreference === 'system'
              ? t('settingsScreens.systemLanguage', {
                  system: t('appearanceScreen.system'),
                  language: languageName,
                })
              : languageName
          }
          details={t('languageScreen.hint', { language: languageName })}
          testID="display-language-locale-row"
          onPress={() =>
            openPicker({
              title: t('languageScreen.sectionLabel'),
              selectedValue: localePreference,
              options: localeOptions,
              searchable: true,
              testID: 'language-picker',
            })
          }
        />
      </SettingsSection>
      <SettingsSection scope="phone" spaced testID="display-language-phone">
        <SegmentedRow
          icon={Moon}
          title={t('appearanceScreen.themeSectionLabel')}
          details={t('appearanceScreen.themeHint')}
          value={themePreference}
          onValueChange={(value) => setThemePreference(value as ThemePreference)}
          testID="appearance-theme"
          options={[
            { value: 'system', label: t('appearanceScreen.system'), testID: 'appearance-system' },
            { value: 'light', label: t('appearanceScreen.themeLight'), testID: 'appearance-light' },
            { value: 'dark', label: t('appearanceScreen.themeDark'), testID: 'appearance-dark' },
          ]}
        />
        <SegmentedRow
          icon={Droplets}
          title={t('appearanceScreen.animationSectionLabel')}
          details={t('appearanceScreen.animationHint')}
          value={sendingAnimation}
          onValueChange={(value) => setSendingAnimation(value as SendingAnimationPreference)}
          testID="sending-animation"
          options={[
            {
              value: 'bubbles',
              label: t('appearanceScreen.animBubbles'),
              testID: 'sending-animation-bubbles',
            },
            {
              value: 'lightning',
              label: t('appearanceScreen.animLightning'),
              testID: 'sending-animation-lightning',
            },
          ]}
        />
      </SettingsSection>
    </AccountScreenLayout>
  );
}
