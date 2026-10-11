import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronRight, Server } from 'lucide-react-native';
import { nip19 } from 'nostr-tools';

import Toast from './BrandedToast';
import { createSharedAccountStyles } from '../screens/account/sharedStyles';
import { useNostr } from '../contexts/NostrContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useThemeColors } from '../contexts/ThemeContext';
import {
  loadMarmotPushSettings,
  parseServerKey,
  setMarmotPushServer,
  type PushServer,
} from '../services/marmotPushRegistration';
import { createNotificationServerSectionStyles } from '../styles/NotificationServerSection.styles';
import { createSecurityScreenStyles } from '../styles/SecurityScreen.styles';

const shortNpub = (hex: string) => {
  const npub = nip19.npubEncode(hex);
  return `${npub.slice(0, 12)}…${npub.slice(-6)}`;
};

/**
 * Which server delivers instant alerts (MIP-05 push). One choice for the
 * whole phone (`marmot_push_server_v1` is a device key, and every account's
 * registration is sealed to it), so it lives under "On this phone" rather
 * than beside the per-account instant-alerts switch. Collapsed by default:
 * a custom npub only works if that server holds the app's Apple/Google push
 * credentials.
 */
const NotificationServerSection: React.FC = () => {
  const colors = useThemeColors();
  const t = useTranslation();
  const { pubkey } = useNostr();
  const shared = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const screen = useMemo(() => createSecurityScreenStyles(colors), [colors]);
  const styles = useMemo(() => createNotificationServerSectionStyles(colors), [colors]);
  const [customServer, setCustomServer] = useState<PushServer | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!pubkey) return;
    void loadMarmotPushSettings(pubkey)
      .catch(() => null)
      .then((s) => {
        if (alive && s) setCustomServer(s.customServer);
      });
    return () => {
      alive = false;
    };
  }, [pubkey]);

  const applyServer = useCallback(
    async (server: string | null) => {
      if (server !== null && !parseServerKey(server)) {
        Toast.show({ type: 'error', text1: t('securityScreen.marmotPushServerInvalid') });
        return;
      }
      setBusy(true);
      try {
        // Re-registers this account's instant alerts with the new server
        // when they're on; null when they're off.
        const outcome = await setMarmotPushServer(server);
        if (pubkey) setCustomServer((await loadMarmotPushSettings(pubkey)).customServer);
        setDraft('');
        if (outcome?.status === 'no-permission')
          Toast.show({ type: 'error', text1: t('securityScreen.marmotPushNoPermission') });
        else if (outcome?.status === 'unavailable')
          Toast.show({ type: 'error', text1: t('securityScreen.marmotPushUnavailable') });
        else if (outcome?.status === 'enabled' && outcome.sync?.declined)
          Toast.show({ type: 'info', text1: t('securityScreen.marmotPushDeclined') });
      } catch {
        Toast.show({ type: 'error', text1: t('securityScreen.marmotPushUnavailable') });
      } finally {
        setBusy(false);
      }
    },
    [pubkey, t],
  );

  return (
    <View testID="notification-server-section">
      <View style={[screen.headerRow, screen.sectionGap]}>
        <Server size={22} color={colors.white} />
        <Text style={[shared.sectionLabel, screen.headerLabel]}>
          {t('securityScreen.marmotPushServerTitle')}
        </Text>
      </View>
      <Text style={shared.fieldHint} testID="security-marmot-push-server-current">
        {customServer
          ? t('securityScreen.marmotPushServerCustom', { npub: shortNpub(customServer.pubkey) })
          : t('securityScreen.marmotPushServerDefault')}
      </Text>

      <TouchableOpacity
        style={styles.toggle}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t('securityScreen.marmotPushAdvanced')}
        testID="security-marmot-push-advanced"
      >
        {open ? (
          <ChevronDown size={16} color={colors.white} />
        ) : (
          <ChevronRight size={16} color={colors.white} />
        )}
        <Text style={styles.toggleText}>{t('securityScreen.marmotPushAdvanced')}</Text>
      </TouchableOpacity>

      {open && (
        <View style={styles.card}>
          <Text style={styles.text}>{t('securityScreen.marmotPushServerHint')}</Text>
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
          <View style={styles.buttons}>
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
    </View>
  );
};

export default NotificationServerSection;
