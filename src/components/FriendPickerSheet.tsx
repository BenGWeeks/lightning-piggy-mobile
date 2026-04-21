import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, BackHandler } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Circle, Path } from 'react-native-svg';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
  BottomSheetTextInput,
  BottomSheetFlatList,
} from '@gorhom/bottom-sheet';
import { useNostr } from '../contexts/NostrContext';
import { colors } from '../styles/theme';

export interface PickedFriend {
  pubkey: string;
  name: string;
  picture: string | null;
  lightningAddress: string | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (friend: PickedFriend) => void;
  title?: string;
  subtitle?: string;
}

const FriendPickerSheet: React.FC<Props> = ({
  visible,
  onClose,
  onSelect,
  title = 'Send to friend',
  subtitle,
}) => {
  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['75%'], []);
  const { contacts } = useNostr();
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (visible) {
      setSearch('');
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const friends = useMemo<PickedFriend[]>(() => {
    const list: PickedFriend[] = contacts.map((c) => ({
      pubkey: c.pubkey,
      name: (c.profile?.displayName || c.profile?.name || c.petname || '').trim(),
      picture: c.profile?.picture ?? null,
      lightningAddress: c.profile?.lud16 ?? null,
    }));
    // Contacts with no resolved name aren't useful here — they can't be
    // reliably identified by the user. Drop them from the picker.
    const named = list.filter((f) => f.name.length > 0);
    named.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    const q = search.trim().toLowerCase();
    if (!q) return named;
    return named.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.lightningAddress && f.lightningAddress.toLowerCase().includes(q)),
    );
  }, [contacts, search]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: PickedFriend }) => (
      <TouchableOpacity
        style={styles.row}
        onPress={() => onSelect(item)}
        activeOpacity={0.6}
        accessibilityLabel={`Send to ${item.name}`}
        testID={`friend-picker-${item.pubkey.slice(0, 8)}`}
      >
        <View style={styles.avatar}>
          {item.picture ? (
            <Image source={{ uri: item.picture }} style={styles.avatarImage} cachePolicy="disk" />
          ) : (
            <View style={styles.avatarFallback}>
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                <Circle cx="12" cy="8" r="4" fill={colors.textSupplementary} />
                <Path
                  d="M4 20c0-3.314 3.582-6 8-6s8 2.686 8 6"
                  stroke={colors.textSupplementary}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              </Svg>
            </View>
          )}
        </View>
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>
            {item.name}
          </Text>
          {item.lightningAddress ? (
            <Text style={styles.address} numberOfLines={1}>
              {item.lightningAddress}
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>
    ),
    [onSelect],
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      onDismiss={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
    >
      <BottomSheetView style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        <BottomSheetTextInput
          style={styles.searchInput}
          placeholder="Search friends"
          placeholderTextColor={colors.textSupplementary}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </BottomSheetView>
      <BottomSheetFlatList<PickedFriend>
        data={friends}
        keyExtractor={(f: PickedFriend) => f.pubkey}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {contacts.length === 0
                ? 'You don’t follow anyone on Nostr yet.'
                : search
                  ? 'No friends match your search.'
                  : 'No contacts with resolved profiles to send to.'}
            </Text>
          </View>
        }
      />
    </BottomSheetModal>
  );
};

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textHeader,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSupplementary,
    marginTop: 4,
    textAlign: 'center',
  },
  searchInput: {
    marginTop: 12,
    backgroundColor: colors.background,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.textHeader,
  },
  listContent: {
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  avatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarFallback: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textHeader,
  },
  address: {
    fontSize: 13,
    color: colors.textSupplementary,
    marginTop: 2,
  },
  empty: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: colors.textSupplementary,
    textAlign: 'center',
  },
});

export default FriendPickerSheet;
