import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { Platform, Text, TouchableOpacity, View } from 'react-native';
import { Smartphone } from 'lucide-react-native';

import Toast from './BrandedToast';
import { useOptimisticSwitch } from '../hooks/useOptimisticSwitch';
import SettingsRow from './SettingsRow';
import { useNostr } from '../contexts/NostrContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useThemeColors } from '../contexts/ThemeContext';
import {
  disableMarmotPush,
  enableMarmotPush,
  subscribeMarmotPushStatus,
  loadMarmotPushSettings,
  pendingMarmotPushGroups,
  syncMarmotPushNow,
  type EnableOutcome,
} from '../services/marmotPushRegistration';
import type { SyncResult } from '../services/marmotPushRegistrar';
import { unregisterWatcherPush } from '../services/watcherPush';
import WatcherPushSection from './WatcherPushSection';
import { createMarmotPushSectionStyles } from '../styles/MarmotPushSection.styles';

/** Account push controls; service handlers and signer setup remain unchanged. */
const MarmotPushSection: React.FC = () => {
  const colors = useThemeColors();
  const t = useTranslation();
  const { signerType, pubkey } = useNostr();
  const styles = useMemo(() => createMarmotPushSectionStyles(colors), [colors]);
  const [enabled, setEnabled] = useState(false);
  // Another account on this phone has push on (same token → linkable).
  const [otherAccounts, setOtherAccounts] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const toggle = useOptimisticSwitch(enabled, setEnabled, () =>
    Toast.show({ type: 'error', text1: t('notificationSettingsScreen.updateFailed') }),
  );
  const busy = finishing || toggle.pending;
  // null = on, but no push token yet.
  const [pending, setPending] = useState<number | null>(0);
  const remoteSigner = signerType === 'amber' || signerType === 'nip46';

  const refreshPending = useCallback(async () => {
    if (!pubkey) return;
    setPending(await pendingMarmotPushGroups(pubkey).catch(() => null));
  }, [pubkey]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setEnabled(false);
      if (!pubkey) return;
      void loadMarmotPushSettings(pubkey)
        .catch(() => null)
        .then((s) => {
          if (!s) return;
          if (!alive) return;
          setEnabled(s.enabled);
          setOtherAccounts(s.otherAccounts);
          if (s.enabled) void refreshPending();
        });
      // The token read and group passes finish in the background.
      const unsubscribe = subscribeMarmotPushStatus(() => void refreshPending());
      return () => {
        alive = false;
        unsubscribe();
      };
    }, [pubkey, refreshPending]),
  );

  const reportSync = useCallback(
    (result: SyncResult | null) => {
      if (result?.declined)
        Toast.show({ type: 'info', text1: t('securityScreen.marmotPushDeclined') });
      void refreshPending();
    },
    [refreshPending, t],
  );

  const reportEnable = useCallback(
    (outcome: EnableOutcome): boolean => {
      if (outcome.status === 'no-permission') {
        Toast.show({ type: 'error', text1: t('securityScreen.marmotPushNoPermission') });
        return false;
      }
      if (outcome.status === 'unavailable') {
        Toast.show({ type: 'error', text1: t('securityScreen.marmotPushUnavailable') });
        return false;
      }
      reportSync(outcome.sync);
      return true;
    },
    [reportSync, t],
  );

  const handleToggle = async (next: boolean) => {
    if (!pubkey) return;
    await toggle.run(next, async () => {
      if (next) {
        const on = reportEnable(await enableMarmotPush(pubkey));
        if (!on) return false;
        if (on) Toast.show({ type: 'success', text1: t('securityScreen.marmotPushOn') });
      } else {
        // While the token still exists: tell the notification watcher to drop
        // this phone (a remote signer may prompt). If it can't, deleting (or,
        // when another account still uses push, replacing) the token below
        // still ends its pushes (Android) / best-effort (iOS).
        const watcherDropped = await unregisterWatcherPush().catch(() => false);
        const off = await disableMarmotPush(pubkey, { stillRegistered: !watcherDropped });
        // (disable never throws — it reports what it couldn't do)
        reportSync(off.sync);
        Toast.show(
          !off.saved
            ? { type: 'error', text1: t('securityScreen.marmotPushSaveFailed') }
            : off.tokenDeleted
              ? { type: 'success', text1: t('securityScreen.marmotPushOff') }
              : { type: 'info', text1: t('securityScreen.marmotPushRetirePending') },
        );
        // Push is off even if storing the preference failed: disable still
        // retracts registrations and retires the token. Keep the switch off.
      }
    });
  };

  const handleFinish = async () => {
    if (!pubkey) return;
    setFinishing(true);
    try {
      reportSync(await syncMarmotPushNow(pubkey));
    } finally {
      setFinishing(false);
    }
  };

  return (
    <>
      <SettingsRow
        icon={Smartphone}
        title={t('securityScreen.marmotPushToggle')}
        subtitle={
          !enabled
            ? t('notificationSettingsScreen.off')
            : pending === null
              ? t('notificationSettingsScreen.pushNoToken')
              : pending > 0
                ? t('notificationSettingsScreen.pushPending', { count: pending })
                : t('notificationSettingsScreen.pushReady')
        }
        subtitleTestID="security-marmot-push-status"
        testID="notifications-instant-alerts"
        infoTestID="security-marmot-push-details"
        details={[
          t(
            Platform.OS === 'ios'
              ? 'securityScreen.marmotPushHintIos'
              : 'securityScreen.marmotPushHintAndroid',
          ),
          t('securityScreen.marmotPushPrivacy'),
          Platform.OS === 'android' && t('securityScreen.marmotPushGoogleFree'),
          remoteSigner && t('securityScreen.marmotPushSignerNote'),
        ]
          .filter(Boolean)
          .join('\n\n')}
        toggle={{
          value: enabled,
          onValueChange: handleToggle,
          disabled: !pubkey,
          pending: busy,
          pendingTestID: 'security-marmot-push-busy',
          accessibilityLabel: t('securityScreen.marmotPushToggle'),
          testID: 'security-marmot-push-toggle',
        }}
      />
      {otherAccounts && (
        <Text style={styles.noticeText} testID="security-marmot-push-other-accounts">
          {t('securityScreen.marmotPushOtherAccounts')}
        </Text>
      )}

      {enabled && (pending === null || pending > 0) && !busy && (
        <View style={styles.statusRow}>
          <TouchableOpacity
            style={styles.pillButton}
            onPress={handleFinish}
            accessibilityRole="button"
            accessibilityLabel={t('securityScreen.marmotPushFinish')}
            testID="security-marmot-push-finish"
          >
            <Text style={styles.pillButtonText}>{t('securityScreen.marmotPushFinish')}</Text>
          </TouchableOpacity>
        </View>
      )}
      <Text style={styles.noticeText}>{t('notificationSettingsScreen.pushConsequence')}</Text>
      <WatcherPushSection pushEnabled={enabled && !busy} />
    </>
  );
};

export default MarmotPushSection;
