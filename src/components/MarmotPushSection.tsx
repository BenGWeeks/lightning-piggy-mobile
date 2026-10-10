import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ChevronDown, ChevronRight, Smartphone } from 'lucide-react-native';
import { nip19 } from 'nostr-tools';

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
  parseServerKey,
  pendingMarmotPushGroups,
  setMarmotPushServer,
  syncMarmotPushNow,
  type EnableOutcome,
  type PushServer,
} from '../services/marmotPushRegistration';
import type { SyncResult } from '../services/marmotPushRegistrar';
import { unregisterWatcherPush } from '../services/watcherPush';
import WatcherPushSection from './WatcherPushSection';
import { createMarmotPushSectionStyles } from '../styles/MarmotPushSection.styles';
import { createSecurityScreenStyles } from '../styles/SecurityScreen.styles';

const shortNpub = (hex: string) => {
  const npub = nip19.npubEncode(hex);
  return `${npub.slice(0, 12)}…${npub.slice(-6)}`;
};

/**
 * Settings → Notifications → For this account: opt-in Marmot push (MIP-05) for the signed-in
 * account. Off by default, and per account: another account on this phone
 * never inherits it. The privacy trade-off (and, for remote-signer users,
 * what approving costs them) sits behind "Privacy details" right above the
 * switch.
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
  const [customServer, setCustomServer] = useState<PushServer | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const remoteSigner = signerType === 'amber' || signerType === 'nip46';

  const refreshPending = useCallback(async () => {
    if (!pubkey) return;
    setPending(await pendingMarmotPushGroups(pubkey).catch(() => null));
  }, [pubkey]);

  useEffect(() => {
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
        setCustomServer(s.customServer);
        if (s.enabled) void refreshPending();
      });
    // The token read and group passes finish in the background.
    const unsubscribe = subscribeMarmotPushStatus(() => void refreshPending());
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [pubkey, refreshPending]);

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

  const applyServer = async (server: string | null) => {
    if (server !== null && !parseServerKey(server)) {
      Toast.show({ type: 'error', text1: t('securityScreen.marmotPushServerInvalid') });
      return;
    }
    setBusy(true);
    try {
      const outcome = await setMarmotPushServer(server);
      if (pubkey) {
        const saved = await loadMarmotPushSettings(pubkey);
        setCustomServer(saved.customServer);
        setEnabled(saved.enabled); // the real state — a failed change leaves push on
      }
      setDraft('');
      if (outcome) reportEnable(outcome);
    } catch {
      Toast.show({ type: 'error', text1: t('securityScreen.marmotPushUnavailable') });
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

      <TouchableOpacity
        style={styles.advancedToggle}
        onPress={() => setAdvancedOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: advancedOpen }}
        accessibilityLabel={t('securityScreen.marmotPushAdvanced')}
        testID="security-marmot-push-advanced"
      >
        {advancedOpen ? (
          <ChevronDown size={16} color={colors.white} />
        ) : (
          <ChevronRight size={16} color={colors.white} />
        )}
        <Text style={styles.advancedToggleText}>{t('securityScreen.marmotPushAdvanced')}</Text>
      </TouchableOpacity>

      {advancedOpen && (
        <View style={styles.advancedCard}>
          <Text style={styles.advancedText} testID="security-marmot-push-server-current">
            {customServer
              ? t('securityScreen.marmotPushServerCustom', { npub: shortNpub(customServer.pubkey) })
              : t('securityScreen.marmotPushServerDefault')}
          </Text>
          <Text style={styles.advancedText}>{t('securityScreen.marmotPushServerHint')}</Text>
          <TextInput
            style={styles.serverInput}
            value={draft}
            onChangeText={setDraft}
            placeholder={t('securityScreen.marmotPushServerPlaceholder')}
            placeholderTextColor={colors.textSupplementary}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={t('securityScreen.marmotPushServerLabel')}
            testID="security-marmot-push-server-input"
          />
          <View style={styles.advancedButtons}>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => applyServer(draft)}
              disabled={busy || draft.trim() === ''}
              accessibilityRole="button"
              accessibilityLabel={t('securityScreen.marmotPushServerSave')}
              testID="security-marmot-push-server-save"
            >
              <Text style={styles.primaryButtonText}>
                {t('securityScreen.marmotPushServerSave')}
              </Text>
            </TouchableOpacity>
            {customServer && (
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => applyServer(null)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={t('securityScreen.marmotPushServerReset')}
                testID="security-marmot-push-server-reset"
              >
                <Text style={styles.secondaryButtonText}>
                  {t('securityScreen.marmotPushServerReset')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
    </>
  );
};

export default MarmotPushSection;
