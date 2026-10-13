import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { UserRound } from 'lucide-react-native';
import { useMutedSenders } from '../hooks/useMutedSenders';
import { useNostrContacts } from '../contexts/NostrContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createMuteNotificationsStyles } from '../styles/MuteNotifications.styles';
import { createSecurityScreenStyles } from '../styles/SecurityScreen.styles';
import { useGroups } from '../contexts/GroupsContext';
import { shortNpub } from '../utils/shortNpub';
import { isSupportedImageUrl } from '../utils/imageUrl';
import Toast from './BrandedToast';

const MutedAccountRow = React.memo(function MutedAccountRow({
  pubkey,
  name,
  picture,
  onUnmute,
}: {
  pubkey: string;
  name: string;
  picture?: string | null;
  onUnmute: (pubkey: string) => void;
}) {
  const t = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createMuteNotificationsStyles(colors), [colors]);
  const settings = useMemo(() => createSecurityScreenStyles(colors), [colors]);
  const [avatarError, setAvatarError] = useState(false);
  useEffect(() => setAvatarError(false), [picture]);
  return (
    <View
      style={[settings.optionRow, styles.cardSegment, styles.row]}
      testID={`muted-account-row-${pubkey}`}
    >
      {picture && !avatarError && isSupportedImageUrl(picture) ? (
        <Image
          source={{ uri: picture }}
          style={styles.avatar}
          cachePolicy="memory-disk"
          recyclingKey={picture}
          autoplay={false}
          onError={() => setAvatarError(true)}
          testID={`muted-account-avatar-${pubkey}`}
        />
      ) : (
        <View
          style={[styles.avatar, styles.avatarFallback]}
          testID={`muted-account-avatar-fallback-${pubkey}`}
        >
          <UserRound size={22} color={colors.textSupplementary} />
        </View>
      )}
      <Text style={styles.identity} numberOfLines={1}>
        {name}
      </Text>
      <TouchableOpacity
        style={styles.unmuteButton}
        accessibilityRole="button"
        accessibilityLabel={t('notificationMute.unmute')}
        testID={`muted-account-unmute-${pubkey}`}
        onPress={() => onUnmute(pubkey)}
      >
        <Text style={styles.unmuteText}>{t('notificationMute.unmuteAction')}</Text>
      </TouchableOpacity>
    </View>
  );
});

export default function MutedAccountsList({ header }: { header?: React.ReactElement }) {
  const { mutedSenders, toggle } = useMutedSenders();
  const { contacts } = useNostrContacts();
  const { getGroup } = useGroups();
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createMuteNotificationsStyles(colors), [colors]);
  const settings = useMemo(() => createSecurityScreenStyles(colors), [colors]);
  const data = useMemo(() => [...mutedSenders].sort(), [mutedSenders]);
  const identities = useMemo(() => {
    const byPubkey = new Map(contacts.map((c) => [c.pubkey.toLowerCase(), c]));
    return new Map(
      data.map((pubkey) => {
        const contact = byPubkey.get(pubkey);
        return [
          pubkey,
          {
            name:
              contact?.profile?.displayName?.trim() ||
              contact?.profile?.name?.trim() ||
              contact?.petname?.trim() ||
              (pubkey.startsWith('group:')
                ? (getGroup(pubkey.slice(6))?.name ?? t('chatMenu.group'))
                : shortNpub(pubkey)),
            picture: contact?.profile?.picture,
          },
        ];
      }),
    );
  }, [contacts, data, getGroup, t]);
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
      <MutedAccountRow
        pubkey={item}
        name={identities.get(item)!.name}
        picture={identities.get(item)?.picture}
        onUnmute={onUnmute}
      />
    ),
    [identities, onUnmute],
  );
  // Contiguous card segments keep the settings header outside the surface
  // while preserving virtualization for a large mute list.
  return (
    <FlatList
      style={styles.list}
      data={data}
      keyExtractor={(item) => item}
      renderItem={renderItem}
      ListHeaderComponent={
        <>
          {header}
          <View
            style={[settings.optionRow, styles.cardSegment, styles.cardHeader]}
            testID="muted-accounts-card-header"
          >
            <Text style={styles.heading}>{t('notificationMute.accounts')}</Text>
          </View>
        </>
      }
      ListFooterComponent={
        <View style={[settings.optionRow, styles.cardSegment, styles.cardFooter]} />
      }
      testID="muted-accounts-list"
      ListEmptyComponent={
        <View style={[settings.optionRow, styles.cardSegment]} testID="muted-accounts-empty">
          <Text style={styles.text}>{t('notificationMute.empty')}</Text>
        </View>
      }
    />
  );
}
