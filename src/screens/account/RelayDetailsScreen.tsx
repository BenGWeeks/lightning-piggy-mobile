import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import Toast from 'react-native-toast-message';
import RelayOperatorSection from '../../components/RelayOperatorSection';
import { relayAcceptedKinds, COMMON_KIND_NAMES } from '../../services/relayKindPolicy';
import { Copy, Server } from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import AccountScreenLayout from './AccountScreenLayout';
import type { RelaySettingsParamList } from '../../navigation/types';
import { useRelayListDraft } from '../../contexts/RelayListEditorContext';
import { useNostr } from '../../contexts/NostrContext';
import { useTranslation } from '../../contexts/LocaleContext';
import { useThemeColors } from '../../contexts/ThemeContext';
import { createRelayDetailsScreenStyles } from '../../styles/RelayDetailsScreen.styles';
import { fetchRelayInformation, type RelayInformation } from '../../services/relayInformation';
import { getRelayHealthObservation, relayKey } from '../../services/relayHealth';
import { pool } from '../../services/nostrPool';
import { relayWriteAcceptance } from '../../utils/relayDetails';
import { useRelayReachability } from '../../hooks/useRelayReachability';
import RelayStatusDot from '../../components/RelayStatusDot';

export default function RelayDetailsScreen({
  route,
  navigation,
}: NativeStackScreenProps<RelaySettingsParamList, 'RelayDetails'>) {
  const { url, kind } = route.params;
  const editor = useRelayListDraft();
  const reachability = useRelayReachability([url]).get(url);
  const { pubkey } = useNostr();
  const t = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createRelayDetailsScreenStyles(colors), [colors]);
  const [info, setInfo] = useState<RelayInformation | null>(null);
  const [loading, setLoading] = useState(true);
  const [iconFailed, setIconFailed] = useState(false);
  const [iconLoaded, setIconLoaded] = useState(false);
  const snapshot = useCallback(
    () => ({
      ...getRelayHealthObservation(url, pubkey),
      observedAt: Date.now(),
      connected: pool.listConnectionStatus().get(relayKey(url)) === true,
    }),
    [url, pubkey],
  );
  const [health, setHealth] = useState(snapshot);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      void fetchRelayInformation(url).then((result) => {
        if (active) {
          setInfo(result);
          setIconFailed(false);
          setIconLoaded(false);
          setLoading(false);
        }
      });
      setHealth(snapshot());
      const timer = setInterval(() => setHealth(snapshot()), 3000);
      return () => {
        active = false;
        clearInterval(timer);
      };
    }, [url, snapshot]),
  );
  const row = editor.nip65Draft.find((r) => r.url === url);
  const present = kind === 'nip65' ? !!row : kind === 'inbox' && editor.inboxDraft.includes(url);
  const editable = present && (kind === 'nip65' ? editor.nip65Editable : editor.inboxEditable);
  const unknown = t('relayDetails.unknown');
  const booleanValue = (value?: boolean) =>
    value === undefined ? unknown : t(value ? 'relayDetails.yes' : 'relayDetails.no');
  const field = (label: string, value?: string | number) => (
    <View key={label}>
      <Text style={styles.label}>{label}</Text>
      <Text selectable style={styles.value}>
        {value ?? unknown}
      </Text>
    </View>
  );
  const limits = info?.limitation;
  const accepted = relayAcceptedKinds(url, info);
  return (
    <AccountScreenLayout title={t('relayDetails.title')}>
      <View style={styles.urlRow}>
        <Text selectable style={styles.url} accessibilityLabel={url}>
          {url}
        </Text>
        <TouchableOpacity
          testID="relay-details-copy"
          accessibilityRole="button"
          accessibilityLabel={t('relayDetails.copyUrl')}
          hitSlop={8}
          onPress={async () => {
            await Clipboard.setStringAsync(url);
            Toast.show({ type: 'success', text1: t('messageActionsSheet.copied') });
          }}
        >
          <Copy size={20} color={colors.white} />
        </TouchableOpacity>
      </View>
      <View style={styles.card} testID="relay-details-about">
        <Text style={styles.heading}>{t('relayDetails.about')}</Text>
        {loading ? (
          <ActivityIndicator testID="relay-details-loading" />
        ) : info ? (
          <>
            <View style={styles.about}>
              <View style={styles.iconBox}>
                {(!info.icon || iconFailed || !iconLoaded) && (
                  <Server size={40} color={colors.white} />
                )}
                {info.icon && !iconFailed && (
                  <Image
                    source={{ uri: info.icon }}
                    style={styles.icon}
                    cachePolicy="memory-disk"
                    onLoad={() => setIconLoaded(true)}
                    onError={() => setIconFailed(true)}
                  />
                )}
              </View>
              <View style={styles.aboutText}>
                <Text style={styles.heading}>{info.name ?? url}</Text>
              </View>
            </View>
            {info.description && (
              <Text selectable style={styles.value}>
                {info.description}
              </Text>
            )}
            {field(
              t('relayDetails.software'),
              [info.software, info.version].filter(Boolean).join(' ') || undefined,
            )}
            {field(
              t('relayDetails.supportedNips'),
              info.supported_nips?.map((n) => `NIP-${String(n).padStart(2, '0')}`).join(', ') ||
                undefined,
            )}
          </>
        ) : (
          <Text style={styles.value}>{t('relayDetails.unavailable')}</Text>
        )}
      </View>
      {info && <RelayOperatorSection key={url} info={info} />}
      <View style={styles.card} testID="relay-details-access">
        <Text style={styles.heading}>{t('relayDetails.access')}</Text>
        {field(
          t('relayDetails.acceptedKinds'),
          accepted
            ? accepted.kinds
                .map(
                  (n) =>
                    `${COMMON_KIND_NAMES[n] ? t(`relayKinds.${COMMON_KIND_NAMES[n]}`) : t('relayKinds.other')} (${n})`,
                )
                .join(', ') || t('relayDetails.noKinds')
            : undefined,
        )}
        {accepted?.source === 'notes' && (
          <Text style={styles.label}>{t('relayDetails.fromNotes')}</Text>
        )}
        {field(t('relayDetails.restrictedWrites'), booleanValue(limits?.restricted_writes))}
        {field(t('relayDetails.payment'), booleanValue(limits?.payment_required))}
        {field(t('relayDetails.auth'), booleanValue(limits?.auth_required))}
        {field(t('relayDetails.maxSubscriptions'), limits?.max_subscriptions)}
        {field(
          t('relayDetails.maxMessage'),
          limits?.max_message_length === undefined
            ? undefined
            : t('relayDetails.bytes', { count: limits.max_message_length }),
        )}
        {field(
          t('relayDetails.acceptsPosts'),
          t(`relayDetails.${relayWriteAcceptance(info, health.lastPublish)}`),
        )}
      </View>
      <View style={styles.card} testID="relay-details-health">
        <Text style={styles.heading}>{t('relayDetails.health')}</Text>
        <View style={styles.about}>
          <RelayStatusDot probe status={reachability?.reachable} testID="relay-details-dot" />
          <Text style={styles.value}>
            {t(
              reachability?.reachable === undefined
                ? 'relayReachability.checking'
                : reachability.reachable
                  ? 'relayReachability.reachable'
                  : 'relayReachability.unreachable',
            )}
          </Text>
        </View>
        {field(
          t('relayReachability.probeChecked'),
          reachability && new Date(reachability.checkedAt).toLocaleTimeString(),
        )}
        {reachability?.error &&
          field(t('relayReachability.probeError'), t(`relayReachability.${reachability.error}`))}
        {field(t('relayReachability.inUse'), booleanValue(health.connected))}
        {field(
          t('relayReachability.poolChecked'),
          new Date(health.observedAt).toLocaleTimeString(),
        )}
        {field(
          t('relayDetails.latency'),
          health.latencyMs === undefined
            ? undefined
            : t('relayDetails.milliseconds', { count: health.latencyMs }),
        )}
        {!health.connected && health.lastConnectFailed && info && (
          <Text style={styles.value}>{t('relayDetails.blocked')}</Text>
        )}
        {field(
          t('relayDetails.recentErrors'),
          health.errors.length
            ? health.errors
                .map((e) => `${new Date(e.at).toLocaleTimeString()}: ${e.message}`)
                .join('\n')
            : t('relayDetails.noErrors'),
        )}
      </View>
      {kind === 'nip65' && row && (
        <View style={styles.card}>
          <Text style={styles.heading}>{t('relayDetails.useRelay')}</Text>
          {(['read', 'write'] as const).map((mode) => (
            <View key={mode} style={styles.toggle}>
              <Text style={styles.value}>{t(`publishedRelays.${mode}`)}</Text>
              <Switch
                value={row[mode]}
                disabled={!editable}
                onValueChange={() => editor.toggleNip65(url, mode)}
                testID={`relay-details-${mode}`}
                accessibilityLabel={t(`publishedRelays.${mode}`)}
              />
            </View>
          ))}
          <Text style={styles.value}>{t('publishedRelays.nip65Hint')}</Text>
        </View>
      )}
      {kind !== 'readonly' && (
        <TouchableOpacity
          style={[styles.remove, !editable && styles.disabled]}
          disabled={!editable}
          testID="relay-details-remove"
          accessibilityRole="button"
          accessibilityLabel={t('publishedRelays.removeLabel', { url })}
          onPress={() => {
            if (kind === 'nip65') editor.removeNip65(url);
            else editor.removeInbox(url);
            navigation.goBack();
          }}
        >
          <Text style={styles.removeText}>{t('relayDetails.remove')}</Text>
        </TouchableOpacity>
      )}
    </AccountScreenLayout>
  );
}
