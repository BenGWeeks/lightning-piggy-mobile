import React, { useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { ChevronLeft, Home } from 'lucide-react-native';
import type { RouteProp } from '@react-navigation/native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import type { Palette } from '../styles/palettes';
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
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { entity, detail } = route.params;

  useEffect(() => {
    console.warn(`[nostr-router] Unsupported entity: ${entity}${detail ? ` (${detail})` : ''}`);
  }, [entity, detail]);

  const goHome = () =>
    navigation.navigate('Main', { screen: 'MainTabs', params: { screen: 'Home' } });

  const goBack = () => (navigation.canGoBack() ? navigation.goBack() : goHome());

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
          style={styles.homeButton}
          onPress={goHome}
          accessibilityLabel={t('unsupportedEntityScreen.backToHome')}
          testID="unsupported-entity-home-button"
        >
          <Home size={18} color={colors.white} strokeWidth={2.5} />
          <Text style={styles.homeButtonText}>{t('unsupportedEntityScreen.backToHome')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 48,
      paddingBottom: 16,
      backgroundColor: colors.brandPink,
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: 18,
      fontWeight: '700',
      color: colors.white,
    },
    headerRightSpacer: { width: 24 },
    body: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      gap: 16,
    },
    piggy: { width: 160, height: 160, marginBottom: 8 },
    title: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.textHeader,
      textAlign: 'center',
    },
    message: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSupplementary,
      textAlign: 'center',
      marginBottom: 8,
    },
    homeButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.brandPink,
      paddingVertical: 14,
      paddingHorizontal: 32,
      borderRadius: 100,
    },
    homeButtonText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  });

export default UnsupportedEntityScreen;
