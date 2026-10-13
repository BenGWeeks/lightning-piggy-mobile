import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Link2, ShieldCheck, KeyRound } from 'lucide-react-native';
import SettingsRow from '../../components/SettingsRow';
import AccountScreenLayout from './AccountScreenLayout';
import type { AccountDrawerNavigation } from '../../navigation/types';
import { useTranslation } from '../../contexts/LocaleContext';
import { useTrustGraph } from '../../contexts/TrustGraphContext';
import { useNostr } from '../../contexts/NostrContext';
import { useAccountState } from '../../contexts/useAccountState';
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
  const t = useTranslation();
  const navigation = useNavigation<AccountDrawerNavigation>();
  const { wotTier } = useTrustGraph();
  const { pubkey } = useNostr();
  // Per account (#1231): reload for the active account, ignore a late answer
  // for one we've switched away from.
  const [linkPreviewOn, setLinkPreviewOn] = useAccountState<boolean>(pubkey, true);
  const [trustOpen, setTrustOpen] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void getLinkPreviewEnabled(pubkey).then((enabled) => {
        if (alive) setLinkPreviewOn(enabled);
      });
      return () => {
        alive = false;
      };
    }, [pubkey, setLinkPreviewOn]),
  );
  const handleToggleLinkPreview = async (next: boolean) => {
    setLinkPreviewOn(next);
    await setLinkPreviewEnabled(next, pubkey);
  };
  return (
    <AccountScreenLayout title={t('messageSettingsScreen.title')}>
      <SettingsScopeHeader scope="account" testID="messages-account" />
      <SettingsRow
        icon={ShieldCheck}
        title={t('messageSettingsScreen.trustTitle')}
        subtitle={t(TIER_TITLE[wotTier])}
        subtitleTestID="messages-trust-tier-value"
        testID="messages-trust-tier"
        accessibilityRole="button"
        onPress={() => setTrustOpen(true)}
        accessibilityLabel={t('messageSettingsScreen.trustRowA11y', {
          tier: t(TIER_TITLE[wotTier]),
        })}
      />
      <SettingsRow
        icon={Link2}
        title={t('securityScreen.showLinkPreviews')}
        subtitle={t('settingsRows.linkPreviewsSubtitle')}
        testID="messages-link-previews"
        details={t('securityScreen.linkPreviewsHint')}
        toggle={{
          value: linkPreviewOn,
          onValueChange: handleToggleLinkPreview,
          accessibilityLabel: t('securityScreen.showLinkPreviewsA11y'),
          testID: 'security-link-preview-toggle',
        }}
      />
      <AmberPermissionSection />
      <SettingsRow
        icon={KeyRound}
        title={t('invitationKeys.title')}
        subtitle={t('invitationKeys.entrySubtitle')}
        testID="nostr-invitation-keys"
        onPress={() => navigation.navigate('AccountInvitationKeys')}
      />
      <WebOfTrustBottomSheet visible={trustOpen} onClose={() => setTrustOpen(false)} />
    </AccountScreenLayout>
  );
};
export default MessageSettingsScreen;
