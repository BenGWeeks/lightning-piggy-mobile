import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
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
import { useTranslation } from '../contexts/LocaleContext';
import type { Palette } from '../styles/palettes';
import {
  createCreateGroupSheetStyles,
  type CreateGroupSheetStyles,
} from '../styles/CreateGroupSheet.styles';
import { DM_PROTOCOL_LABEL } from '../utils/dmProtocol';
import { marmotSendError } from '../services/marmotSend';
import { useNostrContacts } from '../contexts/NostrContext';
import { useGroups } from '../contexts/GroupsContext';
import type { Group } from '../types/groups';
import type { NostrContact } from '../types/nostr';
import AlphabetBar from './AlphabetBar';
import { isSupportedImageUrl } from '../utils/imageUrl';

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
  styles: CreateGroupSheetStyles;
  colors: Palette;
}

// React.memo means rows that didn't change props (typing in the search
// field doesn't touch any of `contact`, `isSelected`, `onToggle`,
// `styles`, `colors`) skip re-render entirely. With ~50 contacts each
// rendering an Image, the inline `.map` was producing the
// flood-render that dropped keystrokes mid-IME-composition. See #243.
const MemberRow = React.memo<MemberRowProps>(
  ({ contact, isSelected, onToggle, styles, colors }) => {
    const t = useTranslation();
    const { displayName } = contact;
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => onToggle(contact.pubkey)}
        accessibilityLabel={t(
          isSelected ? 'createGroupSheet.deselectMember' : 'createGroupSheet.selectMember',
          { name: displayName },
        )}
        testID={`member-row-${contact.pubkey.slice(0, 12)}`}
      >
        <View style={styles.avatar}>
          {isSupportedImageUrl(contact.profile?.picture) ? (
            <Image
              source={{ uri: contact.profile!.picture! }}
              style={styles.avatarImage}
              // memory-disk + recyclingKey match the canonical avatar
              // caching policy (see ConversationRow / ContactListItem /
              // GroupAvatar). Standardised in #245.
              cachePolicy="memory-disk"
              recyclingKey={contact.profile!.picture!}
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

type GroupProtocol = 'nip17' | 'marmot';
const GROUP_PROTOCOLS: GroupProtocol[] = ['nip17', 'marmot'];

const CreateGroupSheet: React.FC<Props> = ({ visible, onClose, onCreated }) => {
  const t = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createCreateGroupSheetStyles(colors), [colors]);
  const { contacts } = useNostrContacts();
  const { createGroup } = useGroups();
  const [step, setStep] = useState<Step>('members');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [currentLetter, setCurrentLetter] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [protocol, setProtocol] = useState<GroupProtocol>('nip17');
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
      setProtocol('nip17');
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
      Alert.alert(
        t('createGroupSheet.nameRequiredTitle'),
        t('createGroupSheet.nameRequiredMessage'),
      );
      return;
    }
    if (selected.size === 0) {
      // Defensive — step 1's Next button enforces this, but we keep the
      // guard so the data contract with createGroup() can never be broken.
      Alert.alert(
        t('createGroupSheet.membersRequiredTitle'),
        t('createGroupSheet.membersRequiredMessage'),
      );
      setStep('members');
      return;
    }
    setSaving(true);
    try {
      const group = await createGroup(
        trimmed,
        Array.from(selected),
        protocol === 'marmot' ? 'marmot' : undefined,
      );
      onCreated?.(group);
      onClose();
    } catch (err) {
      // AsyncStorage write failure (e.g. quota exhausted), or for Marmot a
      // member without a key package. Without try/finally `saving` would
      // stick true and the Create button would stay disabled.
      if (__DEV__) console.warn('[CreateGroupSheet] createGroup failed:', err);
      Alert.alert(
        t('createGroupSheet.createFailedTitle'),
        protocol === 'marmot' ? marmotSendError(err) : t('createGroupSheet.createFailedMessage'),
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
        <Text style={styles.title}>{t('createGroupSheet.newGroupTitle')}</Text>
        <Text style={styles.subtitle}>
          {selected.size > 0
            ? t('createGroupSheet.whosInGroupCount', { count: selected.size })
            : t('createGroupSheet.whosInGroup')}
        </Text>
        <BottomSheetTextInput
          style={styles.searchInput}
          placeholder={t('createGroupSheet.searchFriends')}
          placeholderTextColor={colors.textSupplementary}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t('createGroupSheet.searchFriends')}
          testID="create-group-search"
        />
      </View>
      {sortedContacts.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{t('createGroupSheet.noFriendsYet')}</Text>
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
                <Text style={styles.emptyText}>{t('createGroupSheet.noFriendsMatch')}</Text>
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
          accessibilityLabel={t('createGroupSheet.nextAccessibility')}
          testID="create-group-next"
        >
          <Text style={styles.primaryButtonText}>{t('createGroupSheet.next')}</Text>
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
        <Text style={styles.title}>{t('createGroupSheet.newGroupTitle')}</Text>
        <Text style={styles.subtitle}>{t('createGroupSheet.nameYourGroup')}</Text>
      </View>
      <View style={styles.nameStepBody}>
        <View style={styles.summary}>
          <View style={styles.avatarStrip}>
            {visibleAvatars.map((c) => (
              <View key={c.pubkey} style={styles.summaryAvatar}>
                {isSupportedImageUrl(c.profile?.picture) ? (
                  <Image
                    source={{ uri: c.profile!.picture! }}
                    style={styles.summaryAvatarImage}
                    cachePolicy="memory-disk"
                    recyclingKey={c.profile!.picture!}
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

        <Text style={styles.label}>{t('createGroupSheet.groupNameLabel')}</Text>
        <BottomSheetTextInput
          style={styles.input}
          placeholder={t('createGroupSheet.groupNamePlaceholder')}
          placeholderTextColor={colors.textSupplementary}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          autoCorrect={false}
          autoFocus
          maxLength={80}
          accessibilityLabel={t('createGroupSheet.groupNameAccessibility')}
          testID="create-group-name"
        />

        <Text style={styles.protocolLabel}>{t('dmProtocol.title')}</Text>
        <View style={styles.protocolRow} accessibilityRole="radiogroup">
          {GROUP_PROTOCOLS.map((p) => {
            const active = protocol === p;
            return (
              <TouchableOpacity
                key={p}
                style={[styles.protocolOption, active && styles.protocolOptionActive]}
                onPress={() => setProtocol(p)}
                disabled={saving}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${DM_PROTOCOL_LABEL[p]}. ${t(`dmProtocol.${p}.badge`)}`}
                testID={`create-group-protocol-${p}`}
              >
                <Text style={styles.protocolName}>{DM_PROTOCOL_LABEL[p]}</Text>
                <Text style={styles.protocolBadge}>{t(`dmProtocol.${p}.badge`)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.protocolHint}>{t(`dmProtocol.${protocol}.description`)}</Text>
      </View>
      <View style={styles.footerRow}>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={handleBack}
          disabled={saving}
          accessibilityLabel={t('createGroupSheet.backAccessibility')}
          testID="create-group-back"
        >
          <Text style={styles.secondaryButtonText}>{t('createGroupSheet.back')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryButton, styles.primaryButtonFlex, !canCreate && styles.disabled]}
          onPress={handleCreate}
          disabled={!canCreate}
          accessibilityLabel={t('createGroupSheet.createGroupAccessibility')}
          testID="create-group-submit"
        >
          {saving ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.primaryButtonText}>{t('createGroupSheet.createGroup')}</Text>
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

export default CreateGroupSheet;
