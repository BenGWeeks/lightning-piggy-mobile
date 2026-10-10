import React, { useCallback, useMemo } from 'react';
import { Alert } from '../../components/BrandedAlert';
import AccountScreenLayout from './AccountScreenLayout';
import PublishedRelayListsSection from '../../components/PublishedRelayListsSection';
import AdvancedRelaysSection from '../../components/AdvancedRelaysSection';
import BlossomServersSection from '../../components/BlossomServersSection';
import { useRelayConnectionStatus } from '../../hooks/useRelayConnectionStatus';
import { useNostr } from '../../contexts/NostrContext';
import { useTranslation } from '../../contexts/LocaleContext';

/**
 * Settings → Advanced → Nostr network: your published relay lists, the
 * app-default / geo-cache / device-only relays, and photo & voice-note
 * storage (Blossom). The Amber fix-up moved to Settings → Messages and the
 * native-crypto switch to Advanced → Experimental.
 */
const NostrScreen: React.FC = () => {
  const t = useTranslation();
  const { userRelays, removeUserRelay } = useNostr();
  const connStatus = useRelayConnectionStatus();
  // Device-only relays (added here before published lists existed, #1148).
  const deviceRelays = useMemo(() => userRelays.map((r) => r.url), [userRelays]);

  const handleRemoveRelay = useCallback(
    async (url: string) => {
      try {
        await removeUserRelay(url);
      } catch (e) {
        Alert.alert(
          t('nostrScreen.removeRelayTitle'),
          e instanceof Error ? e.message : t('nostrScreen.failedToRemoveRelay'),
        );
      }
    },
    [removeUserRelay, t],
  );

  return (
    <AccountScreenLayout title={t('nostrScreen.title')} parent="AccountAdvanced">
      <PublishedRelayListsSection connection={connStatus} />
      <AdvancedRelaysSection
        connection={connStatus}
        deviceRelays={deviceRelays}
        onRemoveDeviceRelay={handleRemoveRelay}
      />
      <BlossomServersSection />
    </AccountScreenLayout>
  );
};

export default NostrScreen;
