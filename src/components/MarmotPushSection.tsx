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
import { useNostr } from '../contexts/NostrContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { createSharedAccountStyles } from '../screens/account/sharedStyles';
import {
  disableMarmotPush,
  enableMarmotPush,
  loadMarmotPushSettings,
  parseServerKey,
  pendingMarmotPushGroups,
  setMarmotPushServer,
  syncMarmotPushNow,
  type EnableOutcome,
  type PushServer,
} from '../services/marmotPushRegistration';
import type { SyncResult } from '../services/marmotPushRegistrar';
import { createMarmotPushSectionStyles } from '../styles/MarmotPushSection.styles';
import { createSecurityScreenStyles } from '../styles/SecurityScreen.styles';

const shortNpub = (hex: string) => {
  const npub = nip19.npubEncode(hex);
  return `${npub.slice(0, 12)}…${npub.slice(-6)}`;
};

/**
 * Settings → Security: opt-in Marmot push (MIP-05). Off by default; the
 * privacy trade-off is spelled out before the switch, and remote-signer
 * users are told what approving costs them.
 */
const MarmotPushSection: React.FC = () => {
  const colors = useThemeColors();
  const t = useTranslation();
  const { signerType } = useNostr();
  const shared = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const screen = useMemo(() => createSecurityScreenStyles(colors), [colors]);
  const styles = useMemo(() => createMarmotPushSectionStyles(colors), [colors]);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(0);
  const [customServer, setCustomServer] = useState<PushServer | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const remoteSigner = signerType === 'amber' || signerType === 'nip46';

  const refreshPending = useCallback(async () => {
    setPending(await pendingMarmotPushGroups().catch(() => 0));
  }, []);

  useEffect(() => {
    let alive = true;
    void loadMarmotPushSettings().then((s) => {
      if (!alive) return;
      setEnabled(s.enabled);
      setCustomServer(s.customServer);
      if (s.enabled) void refreshPending();
    });
    return () => {
      alive = false;
    };
  }, [refreshPending]);

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
    setBusy(true);
    try {
      if (next) {
        const on = reportEnable(await enableMarmotPush());
        setEnabled(on);
        if (on) Toast.show({ type: 'success', text1: t('securityScreen.marmotPushOn') });
      } else {
        setEnabled(false);
        const off = await disableMarmotPush();
        reportSync(off.sync);
        Toast.show(
          off.tokenDeleted
            ? { type: 'success', text1: t('securityScreen.marmotPushOff') }
            : { type: 'info', text1: t('securityScreen.marmotPushRetirePending') },
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const handleFinish = async () => {
    setBusy(true);
    try {
      reportSync(await syncMarmotPushNow());
    } finally {
      setBusy(false);
    }
  };

  const applyServer = async (pubkey: string | null) => {
    if (pubkey !== null && !parseServerKey(pubkey)) {
      Toast.show({ type: 'error', text1: t('securityScreen.marmotPushServerInvalid') });
      return;
    }
    setBusy(true);
    try {
      const outcome = await setMarmotPushServer(pubkey);
      setCustomServer((await loadMarmotPushSettings()).customServer);
      setDraft('');
      if (outcome && !reportEnable(outcome)) setEnabled(false);
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
      <Text style={styles.privacyNote}>{t('securityScreen.marmotPushPrivacy')}</Text>
      {remoteSigner && (
        <Text style={styles.privacyNote}>{t('securityScreen.marmotPushSignerNote')}</Text>
      )}

      <View style={screen.toggleRow}>
        <Text style={[screen.optionLabel, styles.toggleLabel]}>
          {t('securityScreen.marmotPushToggle')}
        </Text>
        {busy ? (
          <ActivityIndicator color={colors.brandPink} testID="security-marmot-push-busy" />
        ) : (
          <Switch
            value={enabled}
            onValueChange={handleToggle}
            accessibilityLabel={t('securityScreen.marmotPushToggle')}
            testID="security-marmot-push-toggle"
            trackColor={{ false: colors.divider, true: colors.brandPink }}
            thumbColor={enabled ? colors.white : undefined}
          />
        )}
      </View>

      {enabled && (
        <View style={styles.statusRow} testID="security-marmot-push-status">
          <Text style={styles.statusText}>
            {pending > 0
              ? t('securityScreen.marmotPushPending', { count: pending })
              : t('securityScreen.marmotPushAllSet')}
          </Text>
          {pending > 0 && !busy && (
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
