import React from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Bitcoin, FlaskConical, Gauge, MessageCircle, Radio, Server } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { Alert } from '../../components/BrandedAlert';
import SettingsSection from '../../components/SettingsSection';
import SettingsRow from '../../components/SettingsRow';
import NativeCryptoSection from '../../components/NativeCryptoSection';
import DeviceNoticesSection from '../../components/DeviceNoticesSection';
import { useGroups } from '../../contexts/GroupsContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useTranslation } from '../../contexts/LocaleContext';
import type { AccountDrawerNavigation } from '../../navigation/types';

/** Advanced settings, grouped by where preferences are stored. */
const AdvancedScreen: React.FC = () => {
  const t = useTranslation();
  const navigation = useNavigation<AccountDrawerNavigation>();
  const { outgoingBubbleStyle } = useTheme();
  const { secretMode, setSecretMode } = useGroups();
  const toggleSecretMode = (enabled: boolean) => {
    if (!enabled) {
      setSecretMode(false);
      return;
    }
    Alert.alert(t('advancedScreen.secretConfirmTitle'), t('advancedScreen.secretConfirmBody'), [
      { text: t('accountDrawerContent.cancel'), style: 'cancel' },
      { text: t('advancedScreen.enableSecret'), onPress: () => setSecretMode(true) },
    ]);
  };
  return (
    <AccountScreenLayout title={t('advancedScreen.title')}>
      <SettingsSection scope="account" testID="advanced-account" />
      <SettingsRow
        icon={Radio}
        title={t('nostrScreen.title')}
        subtitle={t('advancedScreen.nostrNetworkSubtitle')}
        testID="advanced-nostr-network"
        onPress={() => navigation.navigate('AccountNostr')}
      />
      <View testID="advanced-experimental-features">
        <SettingsRow
          icon={FlaskConical}
          title={t('advancedScreen.secretMode')}
          subtitle={t('settingsRows.experimentalSubtitle')}
          testID="advanced-secret-mode"
          details={t('advancedScreen.secretHint')}
          toggle={{
            value: secretMode,
            onValueChange: toggleSecretMode,
            testID: 'advanced-secret-mode-toggle',
          }}
        />
      </View>
      <SettingsSection scope="phone" spaced testID="advanced-phone" />
      <SettingsRow
        icon={Bitcoin}
        title={t('onChainScreen.title')}
        subtitle={t('advancedScreen.bitcoinNetworkSubtitle')}
        testID="advanced-bitcoin-network"
        onPress={() => navigation.navigate('AccountOnChain')}
      />
      <SettingsRow
        icon={Server}
        title={t('securityScreen.marmotPushServerTitle')}
        subtitle={t('settingsRows.notificationServerSubtitle')}
        details={t('securityScreen.marmotPushServerHint')}
        testID="advanced-notification-server"
        onPress={() => navigation.navigate('AccountNotificationServer')}
      />
      <NativeCryptoSection />
      <DeviceNoticesSection />
      {__DEV__ && (
        <SettingsRow
          icon={MessageCircle}
          title={t('advancedScreen.bubbleStyle')}
          subtitle={t(`advancedScreen.bubbleStyle${outgoingBubbleStyle}`)}
          testID="advanced-bubble-style-row"
          onPress={() => navigation.navigate('AccountBubbleStyle')}
        />
      )}
      {(__DEV__ || process.env.EXPO_PUBLIC_KEEP_PERF_LOGS === '1') && (
        <SettingsRow
          icon={Gauge}
          title={t('hermesProfiler.title')}
          subtitle={t('settingsRows.profilerSubtitle')}
          testID="advanced-profiler"
          onPress={() => navigation.navigate('AccountProfiler')}
        />
      )}
    </AccountScreenLayout>
  );
};
export default AdvancedScreen;
