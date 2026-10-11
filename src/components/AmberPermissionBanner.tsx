import React, { useMemo } from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useNostr } from '../contexts/NostrContext';
import { useNostrDmInbox } from '../contexts/DmInboxContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createAmberPermissionSectionStyles } from '../styles/AmberPermissionSection.styles';
import type { AccountDrawerNavigation } from '../navigation/types';

/** Routes permission repair to Settings → Messages without subscribing twice. */
const AmberPermissionBanner: React.FC = () => {
  const { signerType } = useNostr();
  const { amberNip44Permission } = useNostrDmInbox();
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createAmberPermissionSectionStyles(colors), [colors]);
  const navigation = useNavigation<AccountDrawerNavigation>();
  if (signerType !== 'amber' || amberNip44Permission !== 'denied') return null;
  return (
    <TouchableOpacity
      style={styles.banner}
      accessibilityRole="button"
      testID="messages-amber-permission-banner"
      accessibilityLabel={t('nostrScreen.grantPermissionInAmber')}
      onPress={() => navigation.navigate('AccountMessages')}
    >
      <Text style={styles.bannerText}>{t('nostrScreen.grantPermissionInAmber')}</Text>
    </TouchableOpacity>
  );
};
export default AmberPermissionBanner;
