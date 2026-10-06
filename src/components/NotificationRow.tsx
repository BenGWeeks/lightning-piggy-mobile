import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import {
  AlertTriangle,
  MapPin,
  MessageCircle,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from 'lucide-react-native';
import type { NotificationKind } from '../services/notificationService';
import type { NotificationHistoryEntry } from '../services/notificationHistory';
import type { NotificationsScreenStyles } from '../styles/NotificationsScreen.styles';

const ICONS: Record<NotificationKind, LucideIcon> = {
  dm: MessageCircle,
  group: Users,
  payment: Wallet,
  zap: Zap,
  cache: MapPin,
  swap: AlertTriangle,
};

interface Props {
  entry: NotificationHistoryEntry;
  /** Display title (e.g. the sender's name resolved from contacts). */
  title: string;
  subtitle: string;
  time: string;
  iconColor: string;
  styles: NotificationsScreenStyles;
  // Receives the entry so the parent can pass one stable handler to every row.
  onPress: (entry: NotificationHistoryEntry) => void;
}

function NotificationRow({ entry, title, subtitle, time, iconColor, styles, onPress }: Props) {
  const Icon = ICONS[entry.kind] ?? MessageCircle;
  return (
    <TouchableOpacity
      style={[styles.row, !entry.read && styles.rowUnread]}
      onPress={() => onPress(entry)}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}, ${time}`}
      accessibilityState={{ selected: !entry.read }}
      testID={`notification-row-${entry.id}`}
    >
      <View style={styles.iconCircle}>
        <Icon size={20} color={iconColor} />
      </View>
      <View style={styles.info}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <View style={styles.meta}>
        <Text style={styles.time}>{time}</Text>
        {!entry.read && (
          <View style={styles.unreadDot} testID={`notification-unread-${entry.id}`} />
        )}
      </View>
    </TouchableOpacity>
  );
}

export default React.memo(NotificationRow);
