import React, { useCallback, useMemo, useState } from 'react';
import { AppState, Linking, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { requestNotificationPermission } from '../services/notificationService';
import { createNotificationPermissionRowStyles } from '../styles/NotificationPermissionRow.styles';

/**
 * Settings → Notifications → On this phone: whether the system lets
 * Lightning Piggy show notifications at all. Every alert on the screen
 * depends on it, so it's the first thing on the phone half. Re-reads the
 * status whenever the screen regains focus or the app comes back from the
 * system settings page.
 */
const NotificationPermissionRow: React.FC = () => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createNotificationPermissionRowStyles(colors), [colors]);
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

  return (
    <View style={styles.permissionRow} testID="notifications-permission-row">
      <View style={styles.permissionText}>
        <Text style={styles.permissionTitle}>
          {t('notificationSettingsScreen.permissionTitle')}
        </Text>
        {granted !== null && (
          <Text style={styles.permissionStatus} testID="notifications-permission-status">
            {granted
              ? t('notificationSettingsScreen.permissionAllowed')
              : t('notificationSettingsScreen.permissionBlocked')}
          </Text>
        )}
      </View>
      {granted === false && (
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={handleTurnOn}
          accessibilityRole="button"
          accessibilityLabel={t('notificationSettingsScreen.permissionTurnOn')}
          testID="notifications-permission-turn-on"
        >
          <Text style={styles.permissionButtonText}>
            {t('notificationSettingsScreen.permissionTurnOn')}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

export default NotificationPermissionRow;
