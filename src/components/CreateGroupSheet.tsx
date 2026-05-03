import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  BackHandler,
  Platform,
  Keyboard,
} from 'react-native';
import { Alert } from './BrandedAlert';
import { Image } from 'expo-image';
import Svg, { Path, Circle } from 'react-native-svg';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetTextInput,
  BottomSheetFlatList,
} from '@gorhom/bottom-sheet';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { useNostr } from '../contexts/NostrContext';
import { useGroups } from '../contexts/GroupsContext';
import type { Group } from '../types/groups';
import type { NostrContact } from '../types/nostr';
import AlphabetBar from './AlphabetBar';

interface Props {
  visible: boolean;
  onClose: () => void;
  onCreated?: (group: Group) => void;
}

type ContactWithLabel = NostrContact & { displayName: string };
type Step = 'members' | 'name';

// Many Nostr contacts prepend emoji/flags/zaps, OR spell their name with
// stylized Unicode variants (𝙰𝚂𝙲𝙾𝚃, ᴄʏʙᴇʀɢᴜʏ, 𝔼𝕣𝕪𝕟) that aren't in the
// plain A-Z range. NFKD-normalize first so compatibility forms fold down
// to their Latin base, then find the first A-Z. Mirrors the helper in
// FriendPickerSheet so both pickers index identically.
const firstAlpha = (name: string): string => {
  const normalized = name.normalize('NFKD').toUpperCase();
  const m = normalized.match(/[A-Z]/);
  return m ? m[0] : '#';
};

interface MemberRowProps {
  contact: ContactWithLabel;
  isSelected: boolean;
  onToggle: (pubkey: string) => void;
  styles: ReturnType<typeof createStyles>;
  colors: Palette;
}

// React.memo means rows that didn't change props (typing in the search
// field doesn't touch any of `contact`, `isSelected`, `onToggle`,
// `styles`, `colors`) skip re-render entirely. With ~50 contacts each
// rendering an Image, the inline `.map` was producing the
// flood-render that dropped keystrokes mid-IME-composition. See #243.
const MemberRow = React.memo<MemberRowProps>(
  ({ contact, isSelected, onToggle, styles, colors }) => {
    const { displayName } = contact;
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => onToggle(contact.pubkey)}
        accessibilityLabel={`${isSelected ? 'Deselect' : 'Select'} ${displayName}`}
        testID={`member-row-${contact.pubkey.slice(0, 12)}`}
      >
        <View style={styles.avatar}>
          {contact.profile?.picture ? (
            <Image
              source={{ uri: contact.profile.picture }}
              style={styles.avatarImage}
              // memory-disk + recyclingKey match the canonical avatar
              // caching policy (see ConversationRow / ContactListItem /
              // GroupAvatar). Standardised in #245.
              cachePolicy="memory-disk"
              recyclingKey={contact.profile.picture}
              // First frame only for animated WebP / GIF avatars.
              // Without this, expo-image spawns a FrameDecoderExe
              // thread per animated avatar and decodes every frame on
              // a continuous loop. Saw 4 threads at >90% CPU each on a
              // fresh AVD with ~50 contacts in the picker. Tapping
              // through to a profile sheet still shows the live
              // animation. See #243.
              autoplay={false}
            />
          ) : (
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <Circle cx="12" cy="8" r="4" fill={colors.textSupplementary} />
              <Path
                d="M4 20c0-3.314 3.582-6 8-6s8 2.686 8 6"
                stroke={colors.textSupplementary}
                strokeWidth={2}
                strokeLinecap="round"
              />
            </Svg>
          )}
        </View>
        <Text style={styles.rowName} numberOfLines={1}>
          {displayName}
        </Text>
        <View style={[styles.checkbox, isSelected && styles.checkboxActive]}>
          {isSelected && (
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
              <Path
                d="M20 6 9 17l-5-5"
                stroke={colors.white}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          )}
        </View>
      </TouchableOpacity>
    );
  },
);
MemberRow.displayName = 'MemberRow';

const CreateGroupSheet: React.FC<Props> = ({ visible, onClose, onCreated }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { contacts } = useNostr();
  const { createGroup } = useGroups();
  const [step, setStep] = useState<Step>('members');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [currentLetter, setCurrentLetter] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const sheetRef = useRef<BottomSheetModal>(null);
  // BottomSheetFlatList's ref exposes the wrapped FlatList's scrollToIndex
  // (and other imperative helpers). Typing it precisely runs into @gorhom's
  // generic constraints; any-ref keeps the call site clean. Pattern matches
  // FriendPickerSheet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listRef = useRef<any>(null);
  // Keep the drag handle clear of Android's notification-shade trigger
  // zone (<48 DP from the top) while still letting the sheet grow past
  // the snap when `keyboardBehavior="interactive"` lifts it for the
  // focused input. Mirrors FriendPickerSheet's 60 DP inset.
  const topInset = 60;
  // Step 1 (members) is a long contact list — needs the long-scroll
  // exception that FriendPickerSheet uses. Step 2 (name) only has the
  // input + buttons but we keep the same 85% snap so the sheet doesn't
  // visibly resize between steps.
  const snapPoints = useMemo(() => ['85%'], []);
  // Canonical bottom-sheet + keyboard pattern from TROUBLESHOOTING.adoc
  // (see NostrLoginSheet.tsx + FriendPickerSheet): track keyboard height
  // and pad the list dynamically. Without it, the list content hides
  // behind the keyboard or the sheet appears to collapse.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // Drive the expensive filter off a deferred copy of `search`. Android's
  // IME can drop characters if the synchronous work triggered by each
  // keystroke (re-sorting + re-rendering every list row) runs faster
  // than composition updates. Mirrors FriendPickerSheet.
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    if (visible) {
      setStep('members');
      setName('');
      setSelected(new Set());
      setSearch('');
      setCurrentLetter(null);
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // Hardware back on step 2 reverts to step 1 instead of dismissing
      // — preserves the natural "back" mental model and keeps selections.
      if (step === 'name') {
        setStep('members');
        return true;
      }
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose, step]);

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

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  // useCallback so MemberRow's `onToggle` prop reference is stable.
  // Without this the row's React.memo bailout would never hit because
  // every render of CreateGroupSheet would produce a fresh toggle fn.
  const toggle = useCallback((pubkey: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pubkey)) next.delete(pubkey);
      else next.add(pubkey);
      return next;
    });
  }, []);

  // Compute `displayName` once per contact here rather than in MemberRow's
  // render — saves the `||` chain firing on every keystroke-driven re-render
  // when memo bailout doesn't apply. Sort uses the same key for consistency.
  const sortedContacts = useMemo<ContactWithLabel[]>(() => {
    const labeled: ContactWithLabel[] = contacts.map((c) => ({
      ...c,
      displayName: c.profile?.displayName || c.profile?.name || c.petname || c.pubkey.slice(0, 12),
    }));
    // Sort by the first Latin letter (so "🇦🇷Marcel" sits with other Ms),
    // then by name within the letter group. Keeps the alphabet bar's
    // scrollToIndex accurate.
    labeled.sort((a, b) => {
      const la = firstAlpha(a.displayName);
      const lb = firstAlpha(b.displayName);
      if (la !== lb) return la.localeCompare(lb);
      return a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase());
    });
    return labeled;
  }, [contacts]);

  const filteredContacts = useMemo<ContactWithLabel[]>(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return sortedContacts;
    return sortedContacts.filter((c) => c.displayName.toLowerCase().includes(q));
  }, [sortedContacts, deferredSearch]);

  const availableLetters = useMemo(() => {
    const letters = new Set<string>();
    for (const c of filteredContacts) letters.add(firstAlpha(c.displayName));
    return Array.from(letters).sort();
  }, [filteredContacts]);

  const handleLetterPress = useCallback(
    (letter: string) => {
      const index = filteredContacts.findIndex((c) => firstAlpha(c.displayName) === letter);
      if (index < 0) return;
      setCurrentLetter(letter);
      listRef.current?.scrollToIndex?.({ index, animated: false, viewPosition: 0 });
    },
    [filteredContacts],
  );

  // Read-only summary of picked members on step 2. Ordered to match the
  // sortedContacts list so the small avatars line up with whichever rows
  // the user just left selected on step 1.
  const pickedContacts = useMemo<ContactWithLabel[]>(
    () => sortedContacts.filter((c) => selected.has(c.pubkey)),
    [sortedContacts, selected],
  );

  const handleNext = () => {
    if (selected.size === 0) return;
    setStep('name');
  };

  const handleBack = () => {
    setStep('members');
  };

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Name required', 'Please enter a group name.');
      return;
    }
    if (selected.size === 0) {
      // Defensive — step 1's Next button enforces this, but we keep the
      // guard so the data contract with createGroup() can never be broken.
      Alert.alert('Members required', 'Please select at least one member.');
      setStep('members');
      return;
    }
    setSaving(true);
    try {
      const group = await createGroup(trimmed, Array.from(selected));
      onCreated?.(group);
      onClose();
    } catch (err) {
      // AsyncStorage write failure (e.g. quota exhausted). Without
      // try/finally `saving` would stick true and the Create button
      // would stay disabled — the user has no way to recover.
      if (__DEV__) console.warn('[CreateGroupSheet] createGroup failed:', err);
      Alert.alert(
        'Could not create group',
        'Failed to save the group locally. Try again or restart the app.',
      );
    } finally {
      setSaving(false);
    }
  };

  const canNext = selected.size > 0;
  const canCreate = name.trim().length > 0 && selected.size > 0 && !saving;

  const renderItem = useCallback(
    ({ item }: { item: ContactWithLabel }) => (
      <MemberRow
        contact={item}
        isSelected={selected.has(item.pubkey)}
        onToggle={toggle}
        styles={styles}
        colors={colors}
      />
    ),
    [selected, toggle, styles, colors],
  );

  // ---------------- Step 1: pick members ----------------
  // Plain <View> at the root mirrors FriendPickerSheet — using
  // <BottomSheetView> here was hiding the absolute-positioned footer
  // because @gorhom's wrapper computes its own height instead of
  // forwarding the modal's content area.
  const renderStepMembers = () => (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>New Group</Text>
        <Text style={styles.subtitle}>
          {selected.size > 0
            ? `Who's in this group? (${selected.size} selected)`
            : "Who's in this group?"}
        </Text>
        <BottomSheetTextInput
          style={styles.searchInput}
          placeholder="Search friends"
          placeholderTextColor={colors.textSupplementary}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search friends"
          testID="create-group-search"
        />
      </View>
      {sortedContacts.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Add Nostr friends first to include them in a group.</Text>
        </View>
      ) : (
        <View style={styles.listWithBar}>
          {availableLetters.length > 0 ? (
            <AlphabetBar
              letters={availableLetters}
              currentLetter={currentLetter}
              onLetterPress={handleLetterPress}
            />
          ) : null}
          <BottomSheetFlatList<ContactWithLabel>
            ref={listRef}
            data={filteredContacts}
            keyExtractor={(c: ContactWithLabel) => c.pubkey}
            renderItem={renderItem}
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: keyboardHeight > 0 ? keyboardHeight + 80 : 100 },
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
                <Text style={styles.emptyText}>No friends match your search.</Text>
              </View>
            }
          />
        </View>
      )}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.primaryButton, !canNext && styles.disabled]}
          onPress={handleNext}
          disabled={!canNext}
          accessibilityLabel="Next: name your group"
          testID="create-group-next"
        >
          <Text style={styles.primaryButtonText}>Next</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ---------------- Step 2: name the group ----------------
  // Cap the avatar strip so a 20-member group doesn't overflow horizontally.
  // Show up to 5 avatars + a "+N" pill for the rest.
  const AVATAR_PREVIEW_CAP = 5;
  const visibleAvatars = pickedContacts.slice(0, AVATAR_PREVIEW_CAP);
  const overflowCount = Math.max(0, pickedContacts.length - AVATAR_PREVIEW_CAP);

  const renderStepName = () => (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>New Group</Text>
        <Text style={styles.subtitle}>Name your group</Text>
      </View>
      <View style={styles.nameStepBody}>
        <View style={styles.summary}>
          <View style={styles.avatarStrip}>
            {visibleAvatars.map((c) => (
              <View key={c.pubkey} style={styles.summaryAvatar}>
                {c.profile?.picture ? (
                  <Image
                    source={{ uri: c.profile.picture }}
                    style={styles.summaryAvatarImage}
                    cachePolicy="memory-disk"
                    recyclingKey={c.profile.picture}
                    autoplay={false}
                  />
                ) : (
                  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                    <Circle cx="12" cy="8" r="4" fill={colors.textSupplementary} />
                    <Path
                      d="M4 20c0-3.314 3.582-6 8-6s8 2.686 8 6"
                      stroke={colors.textSupplementary}
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                  </Svg>
                )}
              </View>
            ))}
            {overflowCount > 0 ? (
              <View style={[styles.summaryAvatar, styles.summaryOverflow]}>
                <Text style={styles.summaryOverflowText}>+{overflowCount}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.summaryText} numberOfLines={2}>
            {pickedContacts.map((c) => c.displayName).join(', ')}
          </Text>
        </View>

        <Text style={styles.label}>Group Name</Text>
        <BottomSheetTextInput
          style={styles.input}
          placeholder="e.g. Family"
          placeholderTextColor={colors.textSupplementary}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          autoCorrect={false}
          autoFocus
          maxLength={80}
          accessibilityLabel="Group name"
          testID="create-group-name"
        />
      </View>
      <View style={styles.footerRow}>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={handleBack}
          disabled={saving}
          accessibilityLabel="Back to member selection"
          testID="create-group-back"
        >
          <Text style={styles.secondaryButtonText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryButton, styles.primaryButtonFlex, !canCreate && styles.disabled]}
          onPress={handleCreate}
          disabled={!canCreate}
          accessibilityLabel="Create group"
          testID="create-group-submit"
        >
          {saving ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.primaryButtonText}>Create Group</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      onDismiss={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      enableContentPanningGesture={false}
      enableOverDrag={false}
      // v5 defaults `enableDynamicSizing` to true → sheet height tracks
      // content height, which collapses to ~0 when Android `adjustResize`
      // shrinks the window as the keyboard opens (gorhom#1602). Turning
      // it off locks the sheet to its explicit snap point. Same caveat
      // as FriendPickerSheet.
      enableDynamicSizing={false}
      topInset={topInset}
    >
      {step === 'members' ? renderStepMembers() : renderStepName()}
    </BottomSheetModal>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    handleIndicator: {
      backgroundColor: colors.divider,
      width: 40,
    },
    container: {
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
    listWithBar: {
      flex: 1,
      flexDirection: 'row',
      overflow: 'hidden',
    },
    list: {
      flex: 1,
    },
    listContent: {
      paddingVertical: 4,
      paddingHorizontal: 20,
      // Reserve space at the bottom for the absolute-positioned footer
      // (52dp button + 12dp top padding + 24dp bottom padding + a 16dp
      // breathing room above the button so the last visible row isn't
      // partially hidden behind the gradient/separator). Without this,
      // BottomSheetView's flex layout collapses our footer's measured
      // height when the FlatList claims `flex: 1` inside an
      // `enableDynamicSizing={false}` sheet.
      paddingBottom: 120,
    },
    nameStepBody: {
      paddingHorizontal: 24,
      paddingTop: 16,
      flex: 1,
    },
    summary: {
      backgroundColor: colors.background,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 20,
    },
    avatarStrip: {
      flexDirection: 'row',
      gap: 6,
      marginBottom: 8,
    },
    summaryAvatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.surface,
      justifyContent: 'center',
      alignItems: 'center',
      overflow: 'hidden',
    },
    summaryAvatarImage: {
      width: 32,
      height: 32,
      borderRadius: 16,
    },
    summaryOverflow: {
      backgroundColor: colors.brandPinkLight,
    },
    summaryOverflowText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.brandPink,
    },
    summaryText: {
      fontSize: 13,
      color: colors.textBody,
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSupplementary,
      marginBottom: 6,
    },
    input: {
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 14,
      fontSize: 15,
      color: colors.textBody,
      fontWeight: '500',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      gap: 12,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.background,
      justifyContent: 'center',
      alignItems: 'center',
      overflow: 'hidden',
    },
    avatarImage: {
      width: 40,
      height: 40,
      borderRadius: 20,
    },
    rowName: {
      flex: 1,
      fontSize: 15,
      fontWeight: '600',
      color: colors.textHeader,
    },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: colors.divider,
      justifyContent: 'center',
      alignItems: 'center',
    },
    checkboxActive: {
      backgroundColor: colors.brandPink,
      borderColor: colors.brandPink,
    },
    empty: {
      padding: 24,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 14,
      color: colors.textSupplementary,
      textAlign: 'center',
      fontStyle: 'italic',
    },
    footer: {
      // Pin the footer to the bottom of the sheet so the FlatList's
      // `flex: 1` can't squeeze it out (BottomSheetView's flex layout
      // ignores measured child heights when nested under
      // `enableDynamicSizing={false}` + a snap-locked sheet). The
      // FlatList compensates with `listContent.paddingBottom` so the
      // last row isn't hidden behind this footer.
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: 24,
      paddingTop: 12,
      paddingBottom: 24,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      backgroundColor: colors.surface,
    },
    footerRow: {
      flexDirection: 'row',
      gap: 12,
      paddingHorizontal: 24,
      paddingTop: 12,
      paddingBottom: 24,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      backgroundColor: colors.surface,
    },
    primaryButton: {
      backgroundColor: colors.brandPink,
      height: 52,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 24,
    },
    primaryButtonFlex: {
      flex: 1,
    },
    primaryButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
    secondaryButton: {
      backgroundColor: colors.background,
      height: 52,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 24,
    },
    secondaryButtonText: {
      color: colors.textBody,
      fontSize: 16,
      fontWeight: '600',
    },
    disabled: {
      opacity: 0.5,
    },
  });

export default CreateGroupSheet;
