import React, { useMemo } from 'react';
import { Text, TouchableOpacity, View, Switch } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ChevronRight } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { createSharedAccountStyles } from './sharedStyles';
import { Alert } from '../../components/BrandedAlert';
import NativeCryptoSection from '../../components/NativeCryptoSection';
import NotificationServerSection from '../../components/NotificationServerSection';
import HermesProfilerSection from '../../components/HermesProfilerSection';
import { useGroups } from '../../contexts/GroupsContext';
import { useThemeColors } from '../../contexts/ThemeContext';
import { useTranslation } from '../../contexts/LocaleContext';
import { createAdvancedScreenStyles } from '../../styles/AdvancedScreen.styles';
import type { AccountDrawerNavigation } from '../../navigation/types';

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
  return (
    <AccountScreenLayout title={t('advancedScreen.title')}>
      {(['AccountNostr', 'AccountOnChain'] as const).map((route) => (
        <TouchableOpacity
          key={route}
          style={styles.navRow}
          onPress={() => navigation.navigate(route)}
          accessibilityRole="button"
          testID={route === 'AccountNostr' ? 'advanced-nostr-network' : 'advanced-bitcoin-network'}
          accessibilityLabel={t(
            route === 'AccountNostr' ? 'nostrScreen.title' : 'onChainScreen.title',
          )}
        >
          <Text style={[shared.sectionLabel, styles.navText]}>
            {t(route === 'AccountNostr' ? 'nostrScreen.title' : 'onChainScreen.title')}
          </Text>
          <ChevronRight size={20} color={colors.white} />
        </TouchableOpacity>
      ))}
      <NotificationServerSection />
      <NativeCryptoSection />
      <View style={styles.sectionGap} testID="advanced-developer-options">
        <Text style={shared.sectionLabel}>{t('advancedScreen.developerOptions')}</Text>
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
          />
        </View>
        <HermesProfilerSection />
      </View>
    </AccountScreenLayout>
  );
};
export default AdvancedScreen;
