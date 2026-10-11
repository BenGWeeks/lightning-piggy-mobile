import React, { memo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { useLocale } from '../contexts/LocaleContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { deviceAge, type InvitationDevice } from '../services/marmotInvitationDevices';
import type { InvitationKeysStyles } from '../styles/InvitationKeysScreen.styles';

type Translate = ReturnType<typeof useLocale>['t'];

/** "This phone", "Another Lightning Piggy device", "White Noise", or the app's name. */
export function deviceLabel(device: InvitationDevice, t: Translate): string {
  switch (device.kind) {
    case 'thisPhone':
      return t('invitationKeys.thisPhone');
    case 'lightningPiggy':
      return t('invitationKeys.otherDevice');
    case 'whiteNoise':
      return t('invitationKeys.whiteNoise');
    default:
      return device.client || t('invitationKeys.otherApp');
  }
}

export function deviceAgeText(device: InvitationDevice, t: Translate): string {
  const age = deviceAge(device.updatedAt);
  if (age.unit === 'never') return t('invitationKeys.notShared');
  if (age.unit === 'justNow') return t('invitationKeys.updatedJustNow');
  return t(age.unit === 'hours' ? 'invitationKeys.updatedHours' : 'invitationKeys.updatedDays', {
    count: age.count,
  });
}

/** A stable, Maestro-friendly id for a device row. */
export const deviceTestId = (device: InvitationDevice) =>
  device.kind === 'thisPhone' ? 'this-phone' : device.slot.slice(0, 12);

interface Props {
  device: InvitationDevice;
  styles: InvitationKeysStyles;
  disabled: boolean;
  onRefresh: () => void;
  /** `summary` names the device for the confirmation, e.g. "White Noise · Last updated 3 days ago". */
  onStop: (device: InvitationDevice, summary: string) => void;
}

export default memo(function InvitationDeviceRow({
  device,
  styles,
  disabled,
  onRefresh,
  onStop,
}: Props) {
  const { t, locale } = useLocale();
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  const label = deviceLabel(device, t);
  const age = deviceAgeText(device, t);
  const id = deviceTestId(device);
  const thisPhone = device.kind === 'thisPhone';
  const date = (secs: number) => new Date(secs * 1000).toLocaleDateString(locale);
  return (
    <View style={styles.card} testID={`invitation-device-${id}`}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{label}</Text>
        {device.old && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{t('invitationKeys.oldBadge')}</Text>
          </View>
        )}
      </View>
      <Text style={styles.age} testID={`invitation-device-age-${id}`}>
        {age}
      </Text>
      {device.versions.length > 0 && (
        <TouchableOpacity
          style={styles.detailsToggle}
          onPress={() => setOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={t('invitationKeys.detailsA11y', { device: label })}
          testID={`invitation-device-details-${id}`}
          hitSlop={8}
        >
          <Text style={styles.detailsToggleText}>{t('invitationKeys.details')}</Text>
          {open ? (
            <ChevronUp size={16} color={colors.white} />
          ) : (
            <ChevronDown size={16} color={colors.white} />
          )}
        </TouchableOpacity>
      )}
      {open && (
        <View style={styles.details} testID={`invitation-device-details-body-${id}`}>
          <Text style={styles.detail}>
            {t('invitationKeys.deviceId', { id: device.slot.slice(0, 12) })}
          </Text>
          {!!device.client && (
            <Text style={styles.detail}>{t('invitationKeys.app', { app: device.client })}</Text>
          )}
          <Text style={styles.detail}>
            {t('invitationKeys.expires', {
              date: device.expires ? date(device.expires) : t('invitationKeys.unknownExpiry'),
            })}
          </Text>
          <Text style={styles.detail}>
            {t('invitationKeys.versions', { count: device.versions.length })}
          </Text>
          <Text style={styles.detail}>
            {t('invitationKeys.relays', { relays: device.relays.join('\n') })}
          </Text>
        </View>
      )}
      {thisPhone ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('invitationKeys.refreshA11y')}
          disabled={disabled}
          style={[styles.button, disabled && styles.disabled]}
          onPress={onRefresh}
          testID="invitation-device-refresh"
        >
          <Text style={styles.buttonText}>{t('invitationKeys.refresh')}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('invitationKeys.stopA11y', { device: label, age })}
          disabled={disabled}
          style={[styles.button, disabled && styles.disabled]}
          onPress={() => onStop(device, `${label} · ${age}`)}
          testID={`invitation-device-stop-${id}`}
        >
          <Text style={styles.buttonText}>{t('invitationKeys.stop')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
});
