import React, { useMemo } from 'react';
import { Text, TouchableOpacity, View, Switch } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ChevronRight } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { createSharedAccountStyles } from './sharedStyles';
import { Alert } from '../../components/BrandedAlert';
import SettingsScopeHeader from '../../components/SettingsScopeHeader';
import NativeCryptoSection from '../../components/NativeCryptoSection';
import NotificationServerSection from '../../components/NotificationServerSection';
import HermesProfilerSection from '../../components/HermesProfilerSection';
import { useGroups } from '../../contexts/GroupsContext';
import { useThemeColors } from '../../contexts/ThemeContext';
import { useTranslation } from '../../contexts/LocaleContext';
import { createAdvancedScreenStyles } from '../../styles/AdvancedScreen.styles';
import type { AccountDrawerNavigation } from '../../navigation/types';

type NetworkRoute = 'AccountNostr' | 'AccountOnChain';

const NETWORK_ROWS: Record<
  NetworkRoute,
  { testID: string; titleKey: string; subtitleKey: string }
> = {
  AccountNostr: {
    testID: 'advanced-nostr-network',
    titleKey: 'nostrScreen.title',
    subtitleKey: 'advancedScreen.nostrNetworkSubtitle',
  },
  AccountOnChain: {
    testID: 'advanced-bitcoin-network',
    titleKey: 'onChainScreen.title',
    subtitleKey: 'advancedScreen.bitcoinNetworkSubtitle',
  },
};

/**
 * Settings → Advanced: things most families never need to touch, split by
 * where they're stored. "For this account": the Nostr network (relays and
 * media storage are published per identity) and experimental features
 * (Secret Mode). "On this phone": the Bitcoin network (Electrum, swap
 * server), the notification server, faster encryption and — in dev/perf
 * builds only — developer options.
 */
const AdvancedScreen: React.FC = () => {
  const colors = useThemeColors();
  const t = useTranslation();
  const navigation = useNavigation<AccountDrawerNavigation>();
  const styles = useMemo(() => createAdvancedScreenStyles(colors), [colors]);
  const shared = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const { secretMode, setSecretMode } = useGroups();
  const toggleSecretMode = (enabled: boolean) => {
    if (!enabled) {
      setSecretMode(false);
      return;
    }
    // Visible opt-in replaces About's triple-tap. A future parent PIN lock
    // belongs at this boundary: https://github.com/BenGWeeks/lightning-piggy-mobile/issues/1221.
    Alert.alert(t('advancedScreen.secretConfirmTitle'), t('advancedScreen.secretConfirmBody'), [
      { text: t('accountDrawerContent.cancel'), style: 'cancel' },
      { text: t('advancedScreen.enableSecret'), onPress: () => setSecretMode(true) },
    ]);
  };

  const networkRow = (route: NetworkRoute) => {
    const row = NETWORK_ROWS[route];
    return (
      <TouchableOpacity
        style={styles.navRow}
        onPress={() => navigation.navigate(route)}
        accessibilityRole="button"
        testID={row.testID}
        accessibilityLabel={t(row.titleKey)}
        accessibilityHint={t(row.subtitleKey)}
      >
        <View style={styles.navText}>
          <Text style={styles.experimentalLabel}>{t(row.titleKey)}</Text>
          <Text style={styles.experimentalSubtitle}>{t(row.subtitleKey)}</Text>
        </View>
        <ChevronRight size={20} color={colors.white} />
      </TouchableOpacity>
    );
  };

  return (
    <AccountScreenLayout title={t('advancedScreen.title')}>
      <SettingsScopeHeader scope="account" testID="advanced-account" />
      {networkRow('AccountNostr')}

      <View style={styles.sectionGap} testID="advanced-experimental-features">
        <Text style={shared.sectionLabel}>{t('advancedScreen.experimentalFeatures')}</Text>
        <View style={styles.experimentalRow}>
          <View style={styles.experimentalTextBlock}>
            <Text style={styles.experimentalLabel}>{t('advancedScreen.secretMode')}</Text>
            <Text style={styles.experimentalSubtitle}>{t('advancedScreen.secretHint')}</Text>
          </View>
          <Switch
            value={secretMode}
            onValueChange={toggleSecretMode}
            testID="advanced-secret-mode-toggle"
            accessibilityLabel={t('advancedScreen.secretMode')}
            trackColor={{ false: colors.divider, true: colors.brandPink }}
            thumbColor={secretMode ? colors.white : undefined}
          />
        </View>
      </View>

      <SettingsScopeHeader scope="phone" spaced testID="advanced-phone" />
      {networkRow('AccountOnChain')}
      <NotificationServerSection />
      <NativeCryptoSection />
      <HermesProfilerSection />
    </AccountScreenLayout>
  );
};
export default AdvancedScreen;
