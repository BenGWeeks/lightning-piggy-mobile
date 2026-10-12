import React, { useMemo } from 'react';
import { TouchableOpacity } from 'react-native';
import { MoreVertical } from 'lucide-react-native';
import { useMuteNotificationAction } from '../hooks/useMuteNotificationAction';
import { useTranslation } from '../contexts/LocaleContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { createMuteNotificationsStyles } from '../styles/MuteNotifications.styles';

export default function ConversationNotificationMenu({ pubkey }: { pubkey: string }) {
  const open = useMuteNotificationAction();
  const t = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createMuteNotificationsStyles(colors), [colors]);
  return (
    <TouchableOpacity
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel={t('notificationMute.menu')}
      testID="conversation-notification-menu"
      onPress={() => open(pubkey, 'conversation-mute-notifications')}
    >
      <MoreVertical size={20} color={colors.textHeader} />
    </TouchableOpacity>
  );
}
