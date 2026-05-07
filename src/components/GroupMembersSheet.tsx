import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet, View, BackHandler } from 'react-native';
import { Image } from 'expo-image';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { UserPlus, UserRound, X } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { useGroups } from '../contexts/GroupsContext';
import { useNostr } from '../contexts/NostrContext';
import { Alert as BrandedAlert } from './BrandedAlert';
import FriendPickerSheet, { type PickedFriend } from './FriendPickerSheet';
import { isSupportedImageUrl } from '../utils/imageUrl';

interface Props {
  visible: boolean;
  groupId: string | null;
  onClose: () => void;
  // Optional. When provided, tapping a member row (other than self)
  // calls this with their pubkey. The host screen typically opens
  // ContactProfileSheet in response. Without this, rows are display-only.
  onMemberTap?: (pubkey: string) => void;
}

interface MemberRow {
  pubkey: string;
  name: string;
  picture: string | null;
}

/**
 * Manage-members bottom sheet for a group conversation. Tapping the
 * "N members" header line in `GroupConversationScreen` opens this.
 *
 * Composition:
 * - Header with the count and a Done button.
 * - Scrollable list of current members (avatar + name + Remove button
 *   per row). Remove confirms via BrandedAlert before persisting.
 * - "Add members" footer button → opens `FriendPickerSheet` filtered to
 *   non-members. Selecting one calls `addMembersToGroup` and closes the
 *   picker; the row appears here without remounting the parent screen.
 *
 * Dynamic membership writes flow through `GroupsContext` so the kind-30200
 * group-state event is republished on each change (see `addMembersToGroup`
 * / `removeMemberFromGroup` in the context).
 *
 * Sheet uses `enableDynamicSizing={false}` + an explicit snap point per
 * the v5 dynamic-sizing collapse fix in `docs/TROUBLESHOOTING.adoc`.
 */
const GroupMembersSheet: React.FC<Props> = ({ visible, groupId, onClose, onMemberTap }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { getGroup, addMembersToGroup, removeMemberFromGroup } = useGroups();
  const { contacts, pubkey: selfPubkey } = useNostr();
  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['85%'], []);
  const [pickerOpen, setPickerOpen] = useState(false);

  const group = groupId ? getGroup(groupId) : undefined;

  // Resolve memberPubkeys → friendly rows. We fall back to a short-pubkey
  // placeholder when no kind-0 profile is in `contacts` (matches the
  // membership chip pattern we replaced).
  const members: MemberRow[] = useMemo(() => {
    if (!group) return [];
    const byPubkey = new Map(contacts.map((c) => [c.pubkey, c]));
    return group.memberPubkeys.map((pk) => {
      const c = byPubkey.get(pk);
      return {
        pubkey: pk,
        name:
          c?.profile?.displayName ||
          c?.profile?.name ||
          c?.petname ||
          `${pk.slice(0, 8)}…${pk.slice(-4)}`,
        picture: c?.profile?.picture ?? null,
      };
    });
  }, [group, contacts]);

  useEffect(() => {
    if (visible) {
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

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  const handleRemove = useCallback(
    (m: MemberRow) => {
      if (!groupId) return;
      BrandedAlert.alert(
        'Remove member?',
        `${m.name} will no longer be in this group. They'll keep any messages they've already received.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => {
              removeMemberFromGroup(groupId, m.pubkey).catch((e) => {
                if (__DEV__) console.warn('[Group] removeMember failed:', e);
              });
            },
          },
        ],
      );
    },
    [groupId, removeMemberFromGroup],
  );

  const handlePickerSelect = useCallback(
    (friend: PickedFriend) => {
      if (!groupId) return;
      addMembersToGroup(groupId, [friend.pubkey]).catch((e) => {
        if (__DEV__) console.warn('[Group] addMember failed:', e);
      });
      setPickerOpen(false);
    },
    [groupId, addMembersToGroup],
  );

  if (!group) return null;

  return (
    <>
      <BottomSheetModal
        ref={sheetRef}
        snapPoints={snapPoints}
        onDismiss={onClose}
        backdropComponent={renderBackdrop}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.handleIndicator}
        enableDynamicSizing={false}
      >
        <BottomSheetScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.headerRow}>
            <Text style={styles.title}>
              {members.length} member{members.length === 1 ? '' : 's'}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              accessibilityLabel="Done"
              testID="group-members-done"
            >
              <Text style={styles.doneText}>Done</Text>
            </TouchableOpacity>
          </View>

          {members.map((m) => (
            <TouchableOpacity
              key={m.pubkey}
              style={styles.row}
              onPress={
                onMemberTap && m.pubkey !== selfPubkey ? () => onMemberTap(m.pubkey) : undefined
              }
              activeOpacity={onMemberTap && m.pubkey !== selfPubkey ? 0.6 : 1}
              accessibilityLabel={`View ${m.name}'s profile`}
              testID={`group-member-row-${m.pubkey.slice(0, 12)}`}
            >
              <View style={styles.avatar}>
                {m.picture && isSupportedImageUrl(m.picture) ? (
                  <Image
                    source={{ uri: m.picture }}
                    style={styles.avatarImage}
                    cachePolicy="memory-disk"
                    recyclingKey={m.picture}
                    autoplay={false}
                  />
                ) : (
                  <UserRound size={22} color={colors.textBody} strokeWidth={1.75} />
                )}
              </View>
              <Text style={styles.rowName} numberOfLines={1}>
                {m.name}
                {m.pubkey === selfPubkey ? <Text style={styles.youTag}> · you</Text> : null}
              </Text>
              {m.pubkey !== selfPubkey ? (
                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => handleRemove(m)}
                  accessibilityLabel={`Remove ${m.name}`}
                  testID={`group-member-remove-${m.pubkey.slice(0, 12)}`}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <X size={18} color={colors.brandPink} strokeWidth={2.5} />
                </TouchableOpacity>
              ) : null}
            </TouchableOpacity>
          ))}

          <TouchableOpacity
            style={styles.addButton}
            onPress={() => setPickerOpen(true)}
            accessibilityLabel="Add members"
            testID="group-members-add"
          >
            <UserPlus size={20} color={colors.brandPink} strokeWidth={2} />
            <Text style={styles.addButtonText}>Add members</Text>
          </TouchableOpacity>
        </BottomSheetScrollView>
      </BottomSheetModal>

      <FriendPickerSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handlePickerSelect}
        title="Add members"
        subtitle="Pick a friend to add to this group"
        excludePubkeys={group.memberPubkeys}
      />
    </>
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
    content: {
      flex: 1,
      paddingHorizontal: 20,
      paddingTop: 8,
    },
    contentContainer: {
      paddingBottom: 60,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    title: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.textHeader,
    },
    doneText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.brandPink,
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
    youTag: {
      fontWeight: '400',
      color: colors.textSupplementary,
    },
    removeButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.brandPinkLight,
      justifyContent: 'center',
      alignItems: 'center',
    },
    addButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: 24,
      paddingVertical: 14,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: colors.brandPink,
      borderStyle: 'dashed',
    },
    addButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.brandPink,
    },
  });

export default GroupMembersSheet;
