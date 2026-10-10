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
import SettingsScopeHeader from '../../components/SettingsScopeHeader';

// Same names as the Web of Trust sheet this row opens (and the filter chip
// on Messages, Map and Events).
const TIER_TITLE = {
  friends: 'webOfTrustBottomSheet.friendsTitle',
  fof: 'webOfTrustBottomSheet.fofTitle',
  all: 'webOfTrustBottomSheet.allTitle',
} as const;

/**
 * Settings → Messages: everything here follows the signed-in account. The
 * trust row is the one shared Web of Trust filter — the same setting as the
 * chip on Messages, Map, Events and Groups — so it's labelled as a "whose
 * content you see" filter, not as a rule about who may message you.
 */
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
      <SettingsScopeHeader scope="account" testID="messages-account" />
      <TouchableOpacity
        style={advanced.navRow}
        onPress={() => setTrustOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t('messageSettingsScreen.trustRowA11y', {
          tier: t(TIER_TITLE[wotTier]),
        })}
        accessibilityHint={t('messageSettingsScreen.trustHint')}
        testID="messages-trust-tier"
      >
        <View style={advanced.navText}>
          <Text style={advanced.experimentalLabel}>{t('messageSettingsScreen.trustTitle')}</Text>
          <Text style={advanced.experimentalSubtitle} testID="messages-trust-tier-value">
            {t(TIER_TITLE[wotTier])}
          </Text>
        </View>
        <ChevronRight size={20} color={colors.white} />
      </TouchableOpacity>
      <Text style={sharedAccountStyles.fieldHint}>{t('messageSettingsScreen.trustHint')}</Text>
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
