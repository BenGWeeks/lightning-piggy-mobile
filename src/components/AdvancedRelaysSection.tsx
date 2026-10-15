import { lockRelays, isTestRelayLockdown } from '../config/testRelayLockdown';
import { useNostr } from '../contexts/NostrContext';
import React, { useCallback, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { DEFAULT_RELAYS } from '../services/nostrService';
import { GC_RELAYS } from '../services/geocacheRelays';
import { MARMOT_KEY_PACKAGE_RELAYS } from '../services/marmotKeyPackageRelays';
import { createAdvancedRelaysSectionStyles } from '../styles/AdvancedRelaysSection.styles';
import RelaySettingsRow from './RelaySettingsRow';
import { RELAY_LIST_INDEXERS } from '../utils/relayListEvents';
import { relayDisplayName, relayRowHost } from '../utils/relayDetails';
import RelayStatusDot from './RelayStatusDot';
import NetworkSectionHeading from './NetworkSectionHeading';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RelaySettingsParamList } from '../navigation/types';

interface Props {
  connection: Map<string, boolean>;
  /** Relays added on this device only (before published lists existed). */
  deviceRelays: string[];
  onRemoveDeviceRelay: (url: string) => void;
}

/**
 * Relays the app uses that aren't the user's own published lists (#1148):
 * the built-in fallbacks, geo-cache and Marmot sets, and any legacy device-only
 * additions. Collapsed by default — most people never need it.
 */
export default function AdvancedRelaysSection({
  connection,
  deviceRelays,
  onRemoveDeviceRelay,
}: Props) {
  const { pubkey } = useNostr();
  const locked = isTestRelayLockdown(pubkey);
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createAdvancedRelaysSectionStyles(colors), [colors]);
  const navigation = useNavigation<NativeStackNavigationProp<RelaySettingsParamList>>();
  const [open, setOpen] = useState(false);
  const openReadOnlyRelay = useCallback(
    (url: string) => navigation.navigate('RelayDetails', { url, kind: 'readonly' }),
    [navigation],
  );

  const readOnlyList = (urls: readonly string[], testID: string) => (
    <View style={styles.list} testID={testID}>
      {lockRelays(urls, pubkey).map((url) => (
        <RelaySettingsRow
          key={url}
          url={url}
          testIDPrefix={`${testID}-`}
          status={connection.get(url)}
          onOpen={openReadOnlyRelay}
        />
      ))}
    </View>
  );

  return (
    <View testID="advanced-relays">
      <TouchableOpacity
        style={styles.toggle}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t('nostrScreen.advancedRelays')}
        testID="advanced-relays-toggle"
      >
        <Text style={styles.toggleText}>{t('nostrScreen.advancedRelays')}</Text>
        {open ? (
          <ChevronUp size={20} color={colors.white} />
        ) : (
          <ChevronDown size={20} color={colors.white} />
        )}
      </TouchableOpacity>
      {open && (
        <>
          <NetworkSectionHeading
            title={t('nostrScreen.defaultRelaysTitle')}
            explanation={t('nostrScreen.defaultRelaysHint')}
            testID="default-relays"
          />
          {readOnlyList(DEFAULT_RELAYS, 'default-relay-list')}
          <NetworkSectionHeading
            title={t('networkInfo.indexersTitle')}
            explanation={t('networkInfo.indexersHint')}
            testID="indexers"
          />
          {readOnlyList(RELAY_LIST_INDEXERS, 'indexer-relay-list')}

          <NetworkSectionHeading
            title={t('nostrScreen.geoCacheRelays')}
            explanation={t('nostrScreen.geoCacheRelaysHint')}
            testID="geoCacheRelays"
          />
          {readOnlyList(GC_RELAYS, 'gc-relay-list')}

          <NetworkSectionHeading
            title={t('nostrScreen.marmotRelays')}
            explanation={t('nostrScreen.marmotRelaysHint')}
            testID="marmotRelays"
          />
          {readOnlyList(MARMOT_KEY_PACKAGE_RELAYS, 'marmot-relay-list')}

          {deviceRelays.length > 0 && (
            <>
              <NetworkSectionHeading
                title={t('nostrScreen.deviceRelaysTitle')}
                explanation={t('nostrScreen.deviceRelaysHint')}
                testID="deviceRelaysTitle"
              />
              <View style={styles.list} testID="device-relay-list">
                {lockRelays(deviceRelays, pubkey).map((url, index) => (
                  <View key={url} style={styles.row}>
                    <RelayStatusDot status={connection.get(url)} />
                    <Text
                      style={styles.url}
                      numberOfLines={2}
                      ellipsizeMode="tail"
                      accessibilityLabel={url}
                    >
                      {relayDisplayName(url)}
                    </Text>
                    <TouchableOpacity
                      onPress={() => onRemoveDeviceRelay(url)}
                      disabled={locked}
                      style={styles.removeButton}
                      testID={`relay-row-remove-device-${index}`}
                      accessibilityLabel={t('publishedRelays.removeHostLabel', {
                        host: relayRowHost(url),
                      })}
                      accessibilityRole="button"
                      hitSlop={8}
                    >
                      <Trash2 size={16} color={colors.brandPink} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </>
          )}
        </>
      )}
    </View>
  );
}
