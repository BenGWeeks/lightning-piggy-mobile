import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Smartphone } from 'lucide-react-native';
import { useLocale } from '../contexts/LocaleContext';
import type { Palette } from '../styles/palettes';
import type { GroupMembersSheetStyles } from '../styles/GroupMembersSheet.styles';
import type { DeviceInfo } from '../services/marmotDeviceTracker';

interface Props {
  /** First 12 hex of the person's pubkey (testID prefix, as the row uses). */
  tid: string;
  /** Null while the sheet is still reading the group. */
  devices: readonly DeviceInfo[] | null;
  styles: GroupMembersSheetStyles;
  colors: Palette;
}

/**
 * One person's devices in a Marmot chat (#1267), under their members-sheet
 * row: one line per MLS leaf with the app that made its invitation key
 * ("Unknown app" when no key could be matched), when that key was made, and
 * the epoch it joined in. Our own leaf reads "This phone".
 */
const MemberDeviceList: React.FC<Props> = ({ tid, devices, styles, colors }) => {
  const { t, formatLocale } = useLocale();
  if (!devices) {
    return (
      <View style={styles.deviceList}>
        <ActivityIndicator size="small" color={colors.textSupplementary} />
      </View>
    );
  }
  const date = (secs: number) => new Date(secs * 1000).toLocaleDateString(formatLocale);
  return (
    <View style={styles.deviceList} testID={`member-devices-${tid}`}>
      {devices.map((d) => {
        const app = d.client ?? t('chatDevices.unknownApp');
        const details: string[] = [];
        if (d.isOwn) details.push(app);
        else if (d.keyCreatedAt)
          details.push(t('chatDevices.keyFrom', { date: date(d.keyCreatedAt) }));
        if (d.firstEpoch !== null) {
          // Ours: we joined then. Someone already here when we arrived: we
          // only know they were there by that epoch.
          details.push(
            d.baseline && !d.isOwn
              ? t('chatDevices.hereWhenYouJoined', { epoch: d.firstEpoch })
              : t('chatDevices.joinedAtEpoch', { epoch: d.firstEpoch }),
          );
        }
        return (
          <View key={d.key} style={styles.deviceRow} testID={`member-device-${tid}-${d.leafIndex}`}>
            <Smartphone
              size={16}
              color={colors.textSupplementary}
              strokeWidth={2}
              style={styles.deviceIcon}
            />
            <View style={styles.deviceText}>
              <Text style={styles.deviceName} numberOfLines={1}>
                {d.isOwn ? t('chatDevices.thisPhone') : app}
              </Text>
              {details.map((line) => (
                <Text key={line} style={styles.deviceDetail} numberOfLines={1}>
                  {line}
                </Text>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
};

export default React.memo(MemberDeviceList);
