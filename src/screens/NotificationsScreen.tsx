import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useNostr, useNostrContacts } from '../contexts/NostrContext';
import { getConversationForEvent } from '../services/dmDb';
import { protocolForWireKind, type DmProtocol } from '../utils/dmProtocol';
import BrandGradientBackground from '../components/BrandGradientBackground';
import NotificationRow from '../components/NotificationRow';
import { useNotificationHistory } from '../hooks/useNotificationHistory';
import { navigateFromNotification } from '../navigation/AppNavigator';
import { formatConversationTimestamp } from '../utils/conversationSummaries';
import type { NotificationHistoryEntry } from '../services/notificationHistory';
import { createNotificationsScreenStyles } from '../styles/NotificationsScreen.styles';

/**
 * In-app history of the notifications the app fired (#1143): find one again
 * after it was swiped away, and open its source. Rows show who / what and
 * when, never message text.
 */
export default function NotificationsScreen() {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createNotificationsScreenStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { contacts } = useNostrContacts();
  const { pubkey } = useNostr();
  const { entries, unreadCount, markRead, markAllRead } = useNotificationHistory();

  // pubkey → display name, built once per contacts change (not per row).
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of contacts) {
      const name = c.profile?.displayName?.trim() || c.profile?.name?.trim() || c.petname?.trim();
      if (name) map.set(c.pubkey.toLowerCase(), name);
    }
    return map;
  }, [contacts]);

  // Rows from alerts the background couldn't decrypt carry only a NIP-17 wrap
  // id; once the app has stored that message, learn its conversation (#1154).
  const [wrapTargets, setWrapTargets] = useState<
    Map<string, { pubkey: string; protocol: DmProtocol }>
  >(new Map());
  useFocusEffect(
    useCallback(() => {
      if (!pubkey) return;
      let cancelled = false;
      const pending = entries.filter(
        (e) => e.data.wrapId && !e.data.conversationPubkey && !wrapTargets.has(e.data.wrapId),
      );
      if (pending.length === 0) return;
      const resolve = async () => {
        const found = new Map(wrapTargets);
        for (const e of pending) {
          const row = await getConversationForEvent(pubkey, e.data.wrapId!).catch(() => null);
          if (row)
            found.set(e.data.wrapId!, {
              pubkey: row.conversation,
              protocol: protocolForWireKind(row.wireKind, row.protocol),
            });
        }
        if (!cancelled && found.size > wrapTargets.size) setWrapTargets(found);
      };
      void resolve();
      // A message decrypted after the screen opened: re-check while rows remain
      // unresolved (a hit re-runs this with fewer pending). Only while this
      // screen is focused, and briefly — a wrap that never lands in the DM store
      // (a group message, a declined decryption) mustn't poll forever.
      let tries = 0;
      const retry = setInterval(() => {
        if (++tries > 10) clearInterval(retry);
        else void resolve();
      }, 3000);
      return () => {
        cancelled = true;
        clearInterval(retry);
      };
    }, [entries, pubkey, wrapTargets]),
  );

  const handlePress = useCallback(
    (entry: NotificationHistoryEntry) => {
      void markRead(entry);
      const resolved = entry.data.wrapId ? wrapTargets.get(entry.data.wrapId) : undefined;
      const partner = (entry.data.conversationPubkey ?? resolved?.pubkey)?.toLowerCase();
      navigateFromNotification({
        kind: entry.kind,
        ...entry.data,
        ...(resolved && {
          conversationPubkey: resolved.pubkey,
          conversationProtocol: resolved.protocol,
        }),
        name: (partner && names.get(partner)) || undefined,
      });
    },
    [markRead, names, wrapTargets],
  );

  const renderItem = useCallback(
    ({ item }: { item: NotificationHistoryEntry }) => {
      const resolved = item.data.wrapId ? wrapTargets.get(item.data.wrapId) : undefined;
      const partner = (item.data.conversationPubkey ?? resolved?.pubkey)?.toLowerCase();
      const title = (partner && names.get(partner)) || item.title;
      const kindLabel = t(`notifications.kind.${item.kind}`);
      return (
        <NotificationRow
          entry={item}
          title={title}
          subtitle={item.body ? `${kindLabel} · ${item.body}` : kindLabel}
          time={formatConversationTimestamp(Math.floor(item.createdAt / 1000))}
          iconColor={colors.brandPink}
          styles={styles}
          onPress={handlePress}
        />
      );
    },
    [names, wrapTargets, t, colors.brandPink, styles, handlePress],
  );

  return (
    <View style={styles.container}>
      <BrandGradientBackground />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel={t('notifications.back')}
          testID="notifications-back"
        >
          <ChevronLeft size={22} color={colors.brandPink} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {t('notifications.title')}
        </Text>
        {unreadCount > 0 && (
          <TouchableOpacity
            style={styles.markAll}
            onPress={() => void markAllRead()}
            accessibilityRole="button"
            accessibilityLabel={t('notifications.markAllRead')}
            testID="notifications-mark-all-read"
          >
            <Text style={styles.markAllText}>{t('notifications.markAllRead')}</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.content}>
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 16 }]}
          ListEmptyComponent={
            <View style={styles.empty} testID="notifications-empty">
              <Text style={styles.emptyTitle}>{t('notifications.emptyTitle')}</Text>
              <Text style={styles.emptyText}>{t('notifications.emptyText')}</Text>
            </View>
          }
          testID="notifications-list"
        />
      </View>
    </View>
  );
}
