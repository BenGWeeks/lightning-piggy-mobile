import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Switch, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Link2, ChevronRight } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { createSharedAccountStyles } from './sharedStyles';
import { useThemeColors } from '../../contexts/ThemeContext';
import { useTranslation } from '../../contexts/LocaleContext';
import { useTrustGraph } from '../../contexts/TrustGraphContext';
import { createSecurityScreenStyles } from '../../styles/SecurityScreen.styles';
import { createAdvancedScreenStyles } from '../../styles/AdvancedScreen.styles';
import { getLinkPreviewEnabled, setLinkPreviewEnabled } from '../../services/linkPreviewPreference';
import WebOfTrustBottomSheet from '../../components/WebOfTrustBottomSheet';
import AmberPermissionSection from '../../components/AmberPermissionSection';

const MessageSettingsScreen: React.FC = () => {
  const colors = useThemeColors();
  const t = useTranslation();
  const sharedAccountStyles = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createSecurityScreenStyles(colors), [colors]);
  const advanced = useMemo(() => createAdvancedScreenStyles(colors), [colors]);
  const { wotTier } = useTrustGraph();
  const [linkPreviewOn, setLinkPreviewOn] = useState(true);
  const [trustOpen, setTrustOpen] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void getLinkPreviewEnabled().then((enabled) => {
        if (alive) setLinkPreviewOn(enabled);
      });
      return () => {
        alive = false;
      };
    }, []),
  );
  const handleToggleLinkPreview = async (next: boolean) => {
    setLinkPreviewOn(next);
    await setLinkPreviewEnabled(next);
  };
  return (
    <AccountScreenLayout title={t('messageSettingsScreen.title')}>
      <TouchableOpacity
        style={advanced.navRow}
        onPress={() => setTrustOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t('messageSettingsScreen.whoCanMessage')}
        testID="messages-trust-tier"
      >
        <View style={advanced.navText}>
          <Text style={sharedAccountStyles.sectionLabel}>
            {t('messageSettingsScreen.whoCanMessage')}
          </Text>
          <Text style={sharedAccountStyles.fieldHint}>{t(`messageSettingsScreen.${wotTier}`)}</Text>
        </View>
        <ChevronRight size={20} color={colors.white} />
      </TouchableOpacity>
      <View style={[styles.headerRow, styles.sectionGap]}>
        <Link2 size={22} color={colors.white} />
        <Text style={[sharedAccountStyles.sectionLabel, styles.headerLabel]}>
          {t('securityScreen.linkPreviews')}
        </Text>
      </View>
      <Text style={sharedAccountStyles.fieldHint}>{t('securityScreen.linkPreviewsHint')}</Text>
      <View style={styles.toggleRow}>
        <Text style={[styles.optionLabel, styles.toggleLabel]}>
          {t('securityScreen.showLinkPreviews')}
        </Text>
        <Switch
          value={linkPreviewOn}
          onValueChange={handleToggleLinkPreview}
          accessibilityLabel={t('securityScreen.showLinkPreviewsA11y')}
          testID="security-link-preview-toggle"
          trackColor={{ false: colors.divider, true: colors.brandPink }}
          thumbColor={linkPreviewOn ? colors.white : undefined}
        />
      </View>
      <AmberPermissionSection />
      {/* Invitation keys belong here when the Marmot agent's screen lands (#1222). */}
      <WebOfTrustBottomSheet visible={trustOpen} onClose={() => setTrustOpen(false)} />
    </AccountScreenLayout>
  );
};
export default MessageSettingsScreen;
