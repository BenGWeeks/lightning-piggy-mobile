import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronRight, Copy, Server } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useFocusEffect } from '@react-navigation/native';

import { Alert } from './BrandedAlert';
import { usePubkeyProfile } from '../hooks/usePubkeyProfile';
import { isSupportedImageUrl } from '../utils/imageUrl';
import { notificationServerDisplay } from '../utils/notificationServerDisplay';

import Toast from './BrandedToast';
import { createSharedAccountStyles } from '../screens/account/sharedStyles';
import { useNostr } from '../contexts/NostrContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useThemeColors } from '../contexts/ThemeContext';
import {
  builtInServer,
  loadMarmotPushSettings,
  notificationServerInboxFound,
  NotificationServerUnavailableError,
  parseServerKey,
  setMarmotPushServer,
  type PushServer,
} from '../services/marmotPushRegistration';
import { createNotificationServerSectionStyles } from '../styles/NotificationServerSection.styles';
import { createSecurityScreenStyles } from '../styles/SecurityScreen.styles';

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
  const [customServer, setCustomServer] = useState<PushServer | null | undefined>(undefined);
  const [settingsUnavailable, setSettingsUnavailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const activeServer = customServer ?? builtInServer();
  const profile = usePubkeyProfile(customServer === undefined ? null : activeServer.pubkey);
  const current = notificationServerDisplay(
    customServer ?? null,
    builtInServer(),
    profile.name,
    t('securityScreen.marmotPushServerName'),
  );
  const [health, setHealth] = useState<{ pubkey: string; found: boolean } | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      if (!pubkey) return;
      void loadMarmotPushSettings(pubkey)
        .then((s) => {
          if (alive) {
            setCustomServer(s.customServer);
            setSettingsUnavailable(false);
          }
        })
        .catch(() => {
          if (alive) setSettingsUnavailable(true);
        });
      return () => {
        alive = false;
      };
    }, [pubkey]),
  );

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      if (customServer === undefined) return;
      void notificationServerInboxFound(activeServer.pubkey).then((found) => {
        if (alive) setHealth({ pubkey: activeServer.pubkey, found });
      });
      return () => {
        alive = false;
      };
    }, [activeServer.pubkey, customServer]),
  );

  const copyServer = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(current.npub);
      Toast.show({ type: 'success', text1: t('contactProfileScreen.publicKeyCopied') });
    } catch {
      Toast.show({ type: 'error', text1: t('securityScreen.marmotPushUnavailable') });
    }
  }, [current.npub, t]);

  const applyServer = useCallback(
    async (server: string | null) => {
      if (server !== null && !parseServerKey(server)) {
        Alert.alert(
          t('securityScreen.marmotPushServerTitle'),
          t('securityScreen.marmotPushServerInvalid'),
        );
        return;
      }
      setBusy(true);
      try {
        // Re-registers this account's instant alerts with the new server
        // when they're on; null when they're off.
        const outcome = await setMarmotPushServer(server);
        if (pubkey) setCustomServer((await loadMarmotPushSettings(pubkey)).customServer);
        setDraft('');
        setOpen(false);
        if (outcome?.status === 'no-permission')
          Toast.show({ type: 'error', text1: t('securityScreen.marmotPushNoPermission') });
        else if (outcome?.status === 'unavailable')
          Toast.show({ type: 'error', text1: t('securityScreen.marmotPushUnavailable') });
        else if (outcome?.status === 'enabled' && outcome.sync?.declined)
          Toast.show({ type: 'info', text1: t('securityScreen.marmotPushDeclined') });
      } catch (error) {
        Alert.alert(
          t('securityScreen.marmotPushServerTitle'),
          t(
            error instanceof NotificationServerUnavailableError
              ? 'securityScreen.marmotPushServerNotFound'
              : 'securityScreen.marmotPushUnavailable',
          ),
        );
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
      {settingsUnavailable ? (
        <Text style={shared.fieldHint}>{t('securityScreen.marmotPushUnavailable')}</Text>
      ) : customServer === undefined ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <View style={styles.card} testID="security-marmot-push-server-card">
          <View style={styles.identity}>
            {profile.picture && isSupportedImageUrl(profile.picture) ? (
              <Image
                source={{ uri: profile.picture }}
                style={styles.avatar}
                cachePolicy="memory-disk"
                recyclingKey={activeServer.pubkey}
                autoplay={false}
              />
            ) : (
              <View style={styles.avatarFallback}>
                <Server size={24} color={colors.brandPink} />
              </View>
            )}
            <View style={styles.details}>
              <Text style={styles.serverName} testID="security-marmot-push-server-current">
                {t('securityScreen.marmotPushServerUsing', { name: current.name })}
                {current.isDefault && (
                  <Text style={styles.defaultBadge} testID="security-marmot-push-server-default">
                    {' '}
                    {t('securityScreen.marmotPushServerBadge')}
                  </Text>
                )}
              </Text>
              <TouchableOpacity
                onPress={copyServer}
                style={styles.copyRow}
                accessibilityRole="button"
                accessibilityLabel={t('contactProfileScreen.copyNpub')}
                testID="security-marmot-push-server-copy"
              >
                <Text style={styles.npub} numberOfLines={1}>
                  {current.shortNpub}
                </Text>
                <Copy size={14} color={colors.brandPink} />
              </TouchableOpacity>
            </View>
          </View>
          {health?.pubkey === activeServer.pubkey && (
            <View style={styles.healthRow} testID="security-marmot-push-server-health">
              <View style={health.found ? styles.healthFound : styles.healthUnknown} />
              <Text style={styles.text}>
                {t(
                  health.found
                    ? 'securityScreen.marmotPushServerInboxFound'
                    : 'securityScreen.marmotPushServerInboxUnknown',
                )}
              </Text>
            </View>
          )}
        </View>
      )}
      {customServer !== undefined && current.canReset && (
        <TouchableOpacity
          style={styles.resetButton}
          onPress={() => applyServer(null)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t('securityScreen.marmotPushServerReset')}
          testID="security-marmot-push-server-reset"
        >
          <Text style={styles.resetText}>{t('securityScreen.marmotPushServerReset')}</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={styles.toggle}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        disabled={busy || customServer === undefined || settingsUnavailable}
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
            editable={!busy}
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
          </View>
        </View>
      )}
    </View>
  );
};

export default NotificationServerSection;
