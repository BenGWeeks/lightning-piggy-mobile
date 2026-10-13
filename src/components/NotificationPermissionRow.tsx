import React, { useCallback, useMemo, useState } from 'react';
import { AppState, Linking, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { BellOff, BellRing } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { requestNotificationPermission } from '../services/notificationService';
import { createSettingsBannerStyles } from '../styles/SettingsBanner.styles';
import SettingsBanner from './SettingsBanner';

/**
 * Top of Settings → Notifications: whether the system lets Lightning Piggy
 * show notifications at all. Every alert on the screen — this account's and
 * the phone's — depends on it, so it sits above both halves: a quiet status
 * line while allowed, a banner with a "Turn on" button while blocked.
 * Re-reads the status whenever the screen regains focus or the app comes
 * back from the system settings page.
 */
const NotificationPermissionRow: React.FC = () => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createSettingsBannerStyles(colors), [colors]);
  // null = not read yet.
  const [granted, setGranted] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    const status = await Notifications.getPermissionsAsync().catch(() => null);
    setGranted(status?.granted ?? false);
  }, []);

  // Only while this screen is focused: a cheap permission read when the user
  // returns from the system settings page — not an app-wide resume handler.
  useFocusEffect(
    useCallback(() => {
      void refresh();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const sub = AppState.addEventListener('change', (state) => {
        if (timer) clearTimeout(timer);
        if (state === 'active') timer = setTimeout(() => void refresh(), 3000);
      });
      return () => {
        if (timer) clearTimeout(timer);
        sub.remove();
      };
    }, [refresh]),
  );

  const handleTurnOn = async () => {
    // Ask in-app when the system still allows it; otherwise (or if the user
    // says no) the only way back is the system settings page.
    const ok = await requestNotificationPermission().catch(() => false);
    if (!ok) await Linking.openSettings().catch(() => undefined);
    void refresh();
  };

  if (granted === null) return null;

  if (granted) {
    return (
      <View style={styles.allowedRow} testID="notifications-permission-row">
        <BellRing size={16} color={colors.white} />
        <Text style={styles.allowedText} testID="notifications-permission-status">
          {t('notificationSettingsScreen.permissionAllowed')}
        </Text>
      </View>
    );
  }

  return (
    <SettingsBanner
      icon={BellOff}
      title={t('notificationSettingsScreen.permissionTitle')}
      subtitle={t('notificationSettingsScreen.permissionBlocked')}
      testID="notifications-permission-row"
      subtitleTestID="notifications-permission-status"
      action={{
        label: t('notificationSettingsScreen.permissionTurnOn'),
        onPress: handleTurnOn,
        testID: 'notifications-permission-turn-on',
      }}
    />
  );
};

export default NotificationPermissionRow;
