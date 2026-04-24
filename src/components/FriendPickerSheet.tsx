import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  BackHandler,
  Keyboard,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import Svg, { Circle, Path } from 'react-native-svg';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetTextInput,
  BottomSheetFlatList,
} from '@gorhom/bottom-sheet';
import { useNostr } from '../contexts/NostrContext';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import AlphabetBar from './AlphabetBar';

export interface PickedFriend {
  pubkey: string;
  name: string;
  picture: string | null;
  lightningAddress: string | null;
}

// Many Nostr contacts prepend emoji/flags/zaps, OR spell their name with
// stylized Unicode variants (𝙰𝚂𝙲𝙾𝚃, ᴄʏʙᴇʀɢᴜʏ, 𝔼𝕣𝕪𝕟) that aren't in the
// plain A-Z range. NFKD-normalize first so compatibility forms fold down
// to their Latin base, then find the first A-Z.
const firstAlpha = (name: string): string => {
  const normalized = name.normalize('NFKD').toUpperCase();
  const m = normalized.match(/[A-Z]/);
  return m ? m[0] : '#';
};

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
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const sheetRef = useRef<BottomSheetModal>(null);
  // BottomSheetFlatList's ref exposes the wrapped FlatList's scrollToIndex
  // (and other imperative helpers). Typing it precisely runs into @gorhom's
  // generic constraints; any-ref keeps the call site clean.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listRef = useRef<any>(null);
  const snapPoints = useMemo(() => ['75%', '90%'], []);
  // Keep the drag handle clear of Android's notification-shade trigger
  // zone (<48 DP from the top) while still letting the sheet grow past
  // the 75% snap when `keyboardBehavior="interactive"` lifts it up to
  // keep the focused input visible above the keyboard. 60 DP is above
  // the notification threshold but leaves plenty of room for keyboard
  // expansion (sheet can still reach ~94% of the screen).
  const topInset = 60;
  const { contacts } = useNostr();
  const [search, setSearch] = useState('');
  const [currentLetter, setCurrentLetter] = useState<string | null>(null);
  // Canonical bottom-sheet + keyboard pattern from TROUBLESHOOTING.adoc
  // (see NostrLoginSheet.tsx): track keyboard height and pad the list's
  // contentContainerStyle dynamically. Without it, the list content
  // hides behind the keyboard or the sheet appears to collapse.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // Drive the expensive filter off a deferred copy of `search`. Android's
  // IME can drop characters if the synchronous work triggered by each
  // keystroke (re-sorting the list + re-rendering every FlatList row)
  // runs faster than composition updates. `useDeferredValue` keeps the
  // input responsive and lets the list catch up when it can.
  const deferredSearch = useDeferredValue(search);

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

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

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
    // Sort by the first Latin letter (so "🇦🇷Marcel" sits with other Ms),
    // then by raw name within the letter group. Keeps the alphabet bar's
    // scrollToIndex accurate.
    named.sort((a, b) => {
      const la = firstAlpha(a.name);
      const lb = firstAlpha(b.name);
      if (la !== lb) return la.localeCompare(lb);
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return named;
    return named.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.lightningAddress && f.lightningAddress.toLowerCase().includes(q)),
    );
  }, [contacts, deferredSearch]);

  const availableLetters = useMemo(() => {
    const letters = new Set<string>();
    for (const f of friends) letters.add(firstAlpha(f.name));
    return Array.from(letters).sort();
  }, [friends]);

  const handleLetterPress = useCallback(
    (letter: string) => {
      const index = friends.findIndex((f) => firstAlpha(f.name) === letter);
      if (index < 0) return;
      setCurrentLetter(letter);
      listRef.current?.scrollToIndex?.({ index, animated: false, viewPosition: 0 });
    },
    [friends],
  );

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
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      enableContentPanningGesture={false}
      enableOverDrag={false}
      // v5 defaults `enableDynamicSizing` to true → sheet height tracks
      // content height, which collapses to ~0 when Android `adjustResize`
      // shrinks the window as the keyboard opens (gorhom#1602). Turning
      // it off locks the sheet to its explicit snap point.
      enableDynamicSizing={false}
      topInset={topInset}
      // Stack on top of the ReceiveSheet rather than dismissing it —
      // @gorhom's default "switch" makes the parent modal dismiss, which
      // cascades to the parent's early-return `if (!visible) return null`
      // and unmounts this modal before it finishes animating in.
      stackBehavior="push"
    >
      {/* Flex column so the sticky header takes its content height and the
       *  list fills the rest. Previous setup nested the search input inside
       *  BottomSheetFlatList's ListHeaderComponent, which swallowed focus
       *  taps because the FlatList's own gesture handler intercepted them. */}
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <View style={styles.titleText}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
          </View>
          <BottomSheetTextInput
            style={styles.searchInput}
            placeholder="Search friends"
            placeholderTextColor={colors.textSupplementary}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
            testID="friend-picker-search"
          />
        </View>
        <View style={styles.listWithBar}>
          {availableLetters.length > 1 ? (
            <AlphabetBar
              letters={availableLetters}
              currentLetter={currentLetter}
              onLetterPress={handleLetterPress}
            />
          ) : null}
          <BottomSheetFlatList<PickedFriend>
            ref={listRef}
            data={friends}
            keyExtractor={(f: PickedFriend) => f.pubkey}
            renderItem={renderItem}
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: keyboardHeight > 0 ? keyboardHeight + 80 : 40 },
            ]}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            onScrollToIndexFailed={(info: {
              index: number;
              highestMeasuredFrameIndex: number;
              averageItemLength: number;
            }) => {
              const offset = info.averageItemLength * info.index;
              listRef.current?.scrollToOffset?.({ offset, animated: false });
              setTimeout(() => {
                listRef.current?.scrollToIndex?.({
                  index: info.index,
                  animated: false,
                  viewPosition: 0,
                });
              }, 50);
            }}
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
        </View>
      </View>
    </BottomSheetModal>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.white,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    container: {
      flex: 1,
    },
    listWithBar: {
      flex: 1,
      flexDirection: 'row',
      overflow: 'hidden',
    },
    list: {
      flex: 1,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    titleText: {
      flex: 1,
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
