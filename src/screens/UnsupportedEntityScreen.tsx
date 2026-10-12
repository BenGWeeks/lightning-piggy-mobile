import React, { useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import { ChevronLeft, Wallet } from 'lucide-react-native';
import type { RouteProp } from '@react-navigation/native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createUnsupportedEntityScreenStyles } from '../styles/UnsupportedEntityScreen.styles';
import type { RootNavigation, RootStackParamList } from '../navigation/types';

interface Props {
  navigation: RootNavigation;
  route: RouteProp<RootStackParamList, 'UnsupportedEntity'>;
}

// Graceful catch-all for a scanned tag / nostr: link whose entity type
// Lightning Piggy has no screen for (e.g. a kind-1 note). The nostr:
// router sends the user here so they always land somewhere friendly
// instead of a blank screen or a crash.
const UnsupportedEntityScreen: React.FC<Props> = ({ navigation, route }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createUnsupportedEntityScreenStyles(colors), [colors]);
  const { entity, detail } = route.params;

  useEffect(() => {
    console.warn(`[nostr-router] Unsupported entity: ${entity}${detail ? ` (${detail})` : ''}`);
  }, [entity, detail]);

  const goToWallets = () =>
    navigation.navigate('Main', { screen: 'MainTabs', params: { screen: 'Home' } });

  const goBack = () => (navigation.canGoBack() ? navigation.goBack() : goToWallets());

  return (
    <View style={styles.container} testID="unsupported-entity-screen">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={goBack}
          accessibilityLabel={t('unsupportedEntityScreen.back')}
          testID="unsupported-entity-back-button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ChevronLeft size={24} color={colors.white} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Lightning Piggy</Text>
        <View style={styles.headerRightSpacer} />
      </View>

      <View style={styles.body}>
        <Image
          source={require('../../assets/images/lightning-piggy-intro.png')}
          style={styles.piggy}
          resizeMode="contain"
          accessibilityLabel="Lightning Piggy"
        />
        <Text style={styles.title}>{t('unsupportedEntityScreen.cantOpenTitle')}</Text>
        <Text style={styles.message}>{t('unsupportedEntityScreen.message', { entity })}</Text>
        <TouchableOpacity
          style={styles.walletsButton}
          onPress={goToWallets}
          accessibilityLabel={t('unsupportedEntityScreen.backToWallets')}
          testID="unsupported-entity-wallets-button"
        >
          <Wallet size={18} color={colors.white} strokeWidth={2.5} />
          <Text style={styles.walletsButtonText}>{t('unsupportedEntityScreen.backToWallets')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default UnsupportedEntityScreen;
