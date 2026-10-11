import React, { useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronUp, X as XIcon } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { DEFAULT_RELAYS } from '../services/nostrService';
import { GC_RELAYS } from '../services/geocacheRelays';
import { createSharedAccountStyles } from '../screens/account/sharedStyles';
import { createAdvancedRelaysSectionStyles } from '../styles/AdvancedRelaysSection.styles';
import RelayStatusDot from './RelayStatusDot';

interface Props {
  connection: Map<string, boolean>;
  /** Relays added on this device only (before published lists existed). */
  deviceRelays: string[];
  onRemoveDeviceRelay: (url: string) => void;
}

/**
 * Relays the app uses that aren't the user's own published lists (#1148):
 * the built-in fallbacks, the geo-cache set, and any legacy device-only
 * additions. Collapsed by default — most people never need it.
 */
export default function AdvancedRelaysSection({
  connection,
  deviceRelays,
  onRemoveDeviceRelay,
}: Props) {
  const colors = useThemeColors();
  const t = useTranslation();
  const shared = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createAdvancedRelaysSectionStyles(colors), [colors]);
  const [open, setOpen] = useState(false);

  const readOnlyList = (urls: readonly string[], testID: string) => (
    <View style={styles.list} testID={testID}>
      {urls.map((url) => (
        <View key={url} style={styles.row}>
          <RelayStatusDot status={connection.get(url)} />
          <Text style={styles.url} numberOfLines={1} ellipsizeMode="middle">
            {url}
          </Text>
        </View>
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
          <Text style={styles.subTitle}>{t('nostrScreen.defaultRelaysTitle')}</Text>
          {readOnlyList(DEFAULT_RELAYS, 'default-relay-list')}
          <Text style={shared.fieldHint}>{t('nostrScreen.defaultRelaysHint')}</Text>

          <Text style={styles.subTitle}>{t('nostrScreen.geoCacheRelays')}</Text>
          {readOnlyList(GC_RELAYS, 'gc-relay-list')}
          <Text style={shared.fieldHint}>{t('nostrScreen.geoCacheRelaysHint')}</Text>

          {deviceRelays.length > 0 && (
            <>
              <Text style={styles.subTitle}>{t('nostrScreen.deviceRelaysTitle')}</Text>
              <View style={styles.list} testID="device-relay-list">
                {deviceRelays.map((url) => (
                  <View key={url} style={styles.row}>
                    <RelayStatusDot status={connection.get(url)} />
                    <Text style={styles.url} numberOfLines={1} ellipsizeMode="middle">
                      {url}
                    </Text>
                    <TouchableOpacity
                      onPress={() => onRemoveDeviceRelay(url)}
                      style={styles.removeButton}
                      testID={`device-relay-remove-${url}`}
                      accessibilityLabel={t('nostrScreen.removeRelayLabel', { url })}
                      accessibilityRole="button"
                      hitSlop={8}
                    >
                      <XIcon size={16} color={colors.white} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
              <Text style={shared.fieldHint}>{t('nostrScreen.deviceRelaysHint')}</Text>
            </>
          )}
        </>
      )}
    </View>
  );
}
