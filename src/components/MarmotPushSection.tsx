import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Smartphone } from 'lucide-react-native';

import Toast from './BrandedToast';
import DetailsDisclosure from './DetailsDisclosure';
import { useNostr } from '../contexts/NostrContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { createSharedAccountStyles } from '../screens/account/sharedStyles';
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
import { createSecurityScreenStyles } from '../styles/SecurityScreen.styles';

/**
 * Settings → Notifications → For this account: opt-in Marmot push (MIP-05) for the signed-in
 * account. Off by default, and per account: another account on this phone
 * never inherits it. The privacy trade-off (and, for remote-signer users,
 * what approving costs them) sits behind "Privacy details" right above the
 * switch. The notification server is one choice for the whole phone, so it
 * lives under Settings → Advanced (NotificationServerSection).
 */
const MarmotPushSection: React.FC = () => {
  const colors = useThemeColors();
  const t = useTranslation();
  const { signerType, pubkey } = useNostr();
  const shared = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const screen = useMemo(() => createSecurityScreenStyles(colors), [colors]);
  const styles = useMemo(() => createMarmotPushSectionStyles(colors), [colors]);
  const [enabled, setEnabled] = useState(false);
  // Another account on this phone has push on (same token → linkable).
  const [otherAccounts, setOtherAccounts] = useState(false);
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    try {
      if (next) {
        const on = reportEnable(await enableMarmotPush(pubkey));
        setEnabled(on);
        if (on) Toast.show({ type: 'success', text1: t('securityScreen.marmotPushOn') });
      } else {
        setEnabled(false);
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
      }
    } finally {
      setBusy(false);
    }
  };

  const handleFinish = async () => {
    if (!pubkey) return;
    setBusy(true);
    try {
      reportSync(await syncMarmotPushNow(pubkey));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <View style={[screen.headerRow, screen.sectionGap]}>
        <Smartphone size={22} color={colors.white} />
        <Text style={[shared.sectionLabel, screen.headerLabel]}>
          {t('securityScreen.marmotPush')}
        </Text>
      </View>
      <Text style={shared.fieldHint}>
        {t(
          Platform.OS === 'ios'
            ? 'securityScreen.marmotPushHintIos'
            : 'securityScreen.marmotPushHintAndroid',
        )}
      </Text>
      <DetailsDisclosure
        label={t('securityScreen.privacyDetails')}
        testID="security-marmot-push-details"
        paragraphs={[
          t('securityScreen.marmotPushPrivacy'),
          Platform.OS === 'android' && t('securityScreen.marmotPushGoogleFree'),
          remoteSigner && t('securityScreen.marmotPushSignerNote'),
        ]}
      />

      <View style={screen.toggleRow}>
        <Text style={[screen.optionLabel, screen.toggleLabel]}>
          {t('securityScreen.marmotPushToggle')}
        </Text>
        {busy ? (
          <ActivityIndicator color={colors.brandPink} testID="security-marmot-push-busy" />
        ) : (
          <Switch
            disabled={!pubkey}
            value={enabled}
            onValueChange={handleToggle}
            accessibilityLabel={t('securityScreen.marmotPushToggle')}
            testID="security-marmot-push-toggle"
            trackColor={{ false: colors.divider, true: colors.brandPink }}
            thumbColor={enabled ? colors.white : undefined}
          />
        )}
      </View>

      {otherAccounts && (
        <Text style={styles.noticeText} testID="security-marmot-push-other-accounts">
          {t('securityScreen.marmotPushOtherAccounts')}
        </Text>
      )}

      {enabled && (
        <View style={styles.statusRow} testID="security-marmot-push-status">
          <Text style={styles.statusText}>
            {pending === null
              ? t('securityScreen.marmotPushNoToken')
              : pending > 0
                ? t('securityScreen.marmotPushPending', { count: pending })
                : t('securityScreen.marmotPushAllSet')}
          </Text>
          {(pending === null || pending > 0) && !busy && (
            <TouchableOpacity
              style={styles.pillButton}
              onPress={handleFinish}
              accessibilityRole="button"
              accessibilityLabel={t('securityScreen.marmotPushFinish')}
              testID="security-marmot-push-finish"
            >
              <Text style={styles.pillButtonText}>{t('securityScreen.marmotPushFinish')}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <WatcherPushSection pushEnabled={enabled} />
    </>
  );
};

export default MarmotPushSection;
