import React, { useCallback, useMemo } from 'react';
import { FlatList, Text, TouchableOpacity, View } from 'react-native';
import { useMutedSenders } from '../hooks/useMutedSenders';
import { useNostrContacts } from '../contexts/NostrContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createMuteNotificationsStyles } from '../styles/MuteNotifications.styles';
import Toast from './BrandedToast';

const MutedAccountRow = React.memo(function MutedAccountRow({
  pubkey,
  name,
  onUnmute,
}: {
  pubkey: string;
  name: string;
  onUnmute: (pubkey: string) => void;
}) {
  const t = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createMuteNotificationsStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      <Text style={styles.identity} numberOfLines={1}>
        {name}
      </Text>
      <TouchableOpacity
        style={styles.button}
        accessibilityRole="button"
        accessibilityLabel={t('notificationMute.unmute')}
        testID={`muted-account-unmute-${pubkey}`}
        onPress={() => onUnmute(pubkey)}
      >
        <Text style={styles.text}>{t('notificationMute.unmute')}</Text>
      </TouchableOpacity>
    </View>
  );
});

export default function MutedAccountsList({ header }: { header?: React.ReactElement }) {
  const { mutedSenders, toggle } = useMutedSenders();
  const { contacts } = useNostrContacts();
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createMuteNotificationsStyles(colors), [colors]);
  const data = useMemo(() => [...mutedSenders].sort(), [mutedSenders]);
  const names = useMemo(
    () =>
      new Map(
        contacts.map((c) => [
          c.pubkey.toLowerCase(),
          c.profile?.displayName || c.profile?.name || c.petname || c.pubkey,
        ]),
      ),
    [contacts],
  );
  const onUnmute = useCallback(
    (pubkey: string) => {
      void toggle(pubkey).catch(() =>
        Toast.show({ type: 'error', text1: t('notificationMute.error') }),
      );
    },
    [toggle, t],
  );
  const renderItem = useCallback(
    ({ item }: { item: string }) => (
      <MutedAccountRow pubkey={item} name={names.get(item) ?? item} onUnmute={onUnmute} />
    ),
    [names, onUnmute],
  );
  return (
    <FlatList
      style={styles.list}
      data={data}
      keyExtractor={(item) => item}
      renderItem={renderItem}
      ListHeaderComponent={
        <>
          {header}
          <Text style={styles.heading}>{t('notificationMute.accounts')}</Text>
        </>
      }
      testID="muted-accounts-list"
      ListEmptyComponent={<Text style={styles.text}>{t('notificationMute.empty')}</Text>}
    />
  );
}
