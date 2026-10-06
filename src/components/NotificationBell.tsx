import React, { useMemo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { Bell } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useNotificationHistory } from '../hooks/useNotificationHistory';
import { createNotificationBellStyles } from '../styles/NotificationBell.styles';
import type { RootStackParamList } from '../navigation/types';

/** Home header bell with an unread count; opens the Notifications screen (#1143). */
function NotificationBell() {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createNotificationBellStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { unreadCount } = useNotificationHistory();
  const label =
    unreadCount > 0
      ? t('notifications.bellUnread', { count: unreadCount })
      : t('notifications.bell');
  return (
    <TouchableOpacity
      style={styles.button}
      onPress={() => navigation.navigate('Notifications')}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID="notifications-bell"
      hitSlop={6}
    >
      <Bell size={20} color={colors.white} strokeWidth={2} />
      {unreadCount > 0 && (
        <View style={styles.badge} testID="notifications-bell-badge">
          <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default React.memo(NotificationBell);
