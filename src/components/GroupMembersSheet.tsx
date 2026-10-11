import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, TouchableOpacity, View, BackHandler } from 'react-native';
import {
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { BottomSheetModal } from './AccessibleBottomSheetModal';
import { UserPlus } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createGroupMembersSheetStyles } from '../styles/GroupMembersSheet.styles';
import { marmotSendError } from '../services/marmotSend';
import { useGroups } from '../contexts/GroupsContext';
import { useNostr, useNostrContacts } from '../contexts/NostrContext';
import { Alert as BrandedAlert } from './BrandedAlert';
import Toast from './BrandedToast';
import FriendPickerSheet, { type PickedFriend } from './FriendPickerSheet';
import GroupMemberListRow from './GroupMemberListRow';
import type { GroupMemberRow } from '../utils/groupMemberRows';
import { useGroupAdminActions } from '../hooks/useGroupAdminActions';
import { canManageGroup } from '../utils/groupAdmins';

interface Props {
  visible: boolean;
  groupId: string | null;
  onClose: () => void;
  // Resolved rows (self first) from the host screen's single
  // `useGroupMemberProfiles` + `buildGroupMemberRows` pass, so the sheet,
  // header count and sender labels share one lookup (#1268).
  members: GroupMemberRow[];
  // Optional. When provided, tapping a member row (other than self)
  // calls this with their pubkey. The host screen typically opens
  // ContactProfileSheet in response. Without this, rows are display-only.
  onMemberTap?: (pubkey: string) => void;
}

/**
 * Manage-members bottom sheet for a group conversation. Tapping the
 * "N members" header line in `GroupConversationScreen` opens this.
 *
 * Composition:
 * - Header with the count and a Done button.
 * - Scrollable list of current members (avatar + name + follow status +
 *   Remove button per row). Remove confirms via BrandedAlert before
 *   persisting; Follow publishes through the shared `followContact` path
 *   (so Amber / NIP-46 prompts behave as everywhere else).
 * - Marmot groups: an Admin badge on admins' rows, and for admins a "⋯"
 *   menu to make / remove admins (`useGroupAdminActions`).
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
const GroupMembersSheet: React.FC<Props> = ({
  visible,
  groupId,
  onClose,
  members,
  onMemberTap,
}) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createGroupMembersSheetStyles(colors), [colors]);
  const { getGroup, addMembersToGroup, removeMemberFromGroup } = useGroups();
  const { pubkey: selfPubkey } = useNostr();
  const { followContact } = useNostrContacts();
  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['85%'], []);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Follows are single-flight: `followContact` republishes the whole kind-3
  // from the `contacts` it closed over, so two concurrent follows would race
  // and drop one. It resolves after `contacts` updates, flipping the row to
  // "Following" in place.
  const [followPendingPubkey, setFollowPendingPubkey] = useState<string | null>(null);
  const followInFlight = useRef(false);

  const group = groupId ? getGroup(groupId) : undefined;
  // NIP-17 groups are editable by anyone; a Marmot group only by its admins
  // (MLS rejects a non-admin's membership commit).
  const isMarmot = group?.protocol === 'marmot';
  const adminSet = useMemo(
    () => new Set((group?.adminPubkeys ?? []).map((p) => p.toLowerCase())),
    [group?.adminPubkeys],
  );
  // Same rule as the header's rename pencil: anyone in NIP-17, admins in Marmot.
  const canManage = canManageGroup(group, selfPubkey);
  // Only Marmot groups have admins; 1:1 DMs never reach this sheet, so any
  // Marmot group here is multi-member. Non-admins see badges, no actions.
  const { adminPendingPubkey, openAdminActions } = useGroupAdminActions(group);
  const onAdminActions = isMarmot && canManage ? openAdminActions : undefined;
  const reportFailure = useCallback(
    (e: unknown) => {
      if (__DEV__) console.warn('[Group] membership change failed:', e);
      // NIP-17 changes are local-first and effectively can't fail; a Marmot
      // change is an MLS commit (e.g. the friend has no key package yet).
      if (group?.protocol === 'marmot') {
        BrandedAlert.alert(t('createGroupSheet.createFailedTitle'), marmotSendError(e));
      }
    },
    [group?.protocol, t],
  );

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
    (m: GroupMemberRow) => {
      if (!groupId) return;
      BrandedAlert.alert(
        t('groupMembersSheet.removeTitle'),
        t('groupMembersSheet.removeMessage', { name: m.name }),
        [
          { text: t('groupMembersSheet.cancel'), style: 'cancel' },
          {
            text: t('groupMembersSheet.remove'),
            style: 'destructive',
            onPress: () => {
              removeMemberFromGroup(groupId, m.pubkey).catch(reportFailure);
            },
          },
        ],
      );
    },
    [groupId, removeMemberFromGroup, t, reportFailure],
  );

  const handleFollow = useCallback(
    async (m: GroupMemberRow) => {
      if (followInFlight.current) return;
      followInFlight.current = true;
      setFollowPendingPubkey(m.pubkey);
      // `false` = the follow path already gave its own feedback (e.g. the
      // "Couldn't load your follow list" toast, #1271) or the signer was
      // declined: don't replace it. Only an unexpected throw gets ours.
      let outcome: 'followed' | 'declined' | 'error' = 'error';
      try {
        outcome = (await followContact(m.pubkey)) ? 'followed' : 'declined';
      } catch (e) {
        if (__DEV__) console.warn('[Group] follow failed:', e);
      } finally {
        followInFlight.current = false;
        setFollowPendingPubkey(null);
      }
      if (outcome === 'followed') {
        Toast.show({
          type: 'success',
          text1: t('groupMembersSheet.followedToast', { name: m.name }),
        });
      } else if (outcome === 'error') {
        Toast.show({ type: 'error', text1: t('groupMembersSheet.followFailed', { name: m.name }) });
      }
    },
    [followContact, t],
  );

  const handleMemberPress = useCallback(
    (m: GroupMemberRow) => onMemberTap?.(m.pubkey),
    [onMemberTap],
  );

  const handlePickerSelect = useCallback(
    (friend: PickedFriend) => {
      if (!groupId) return;
      addMembersToGroup(groupId, [friend.pubkey]).catch(reportFailure);
      setPickerOpen(false);
    },
    [groupId, addMembersToGroup, reportFailure],
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
              {t(
                members.length === 1
                  ? 'groupMembersSheet.memberCountOne'
                  : 'groupMembersSheet.memberCountOther',
                { count: members.length },
              )}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              accessibilityLabel={t('groupMembersSheet.done')}
              testID="group-members-done"
            >
              <Text style={styles.doneText}>{t('groupMembersSheet.done')}</Text>
            </TouchableOpacity>
          </View>

          {members.map((m) => (
            <GroupMemberListRow
              key={m.pubkey}
              member={m}
              styles={styles}
              colors={colors}
              canRemove={canManage}
              isAdmin={isMarmot && adminSet.has(m.pubkey.toLowerCase())}
              adminActionsDisabled={adminPendingPubkey !== null}
              onAdminActions={onAdminActions}
              followPending={followPendingPubkey === m.pubkey}
              followDisabled={followPendingPubkey !== null && followPendingPubkey !== m.pubkey}
              onPress={onMemberTap ? handleMemberPress : undefined}
              onRemove={handleRemove}
              onFollow={handleFollow}
            />
          ))}

          {canManage ? (
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => setPickerOpen(true)}
              accessibilityLabel={t('groupMembersSheet.addMembers')}
              testID="group-members-add"
            >
              <UserPlus size={20} color={colors.brandPink} strokeWidth={2} />
              <Text style={styles.addButtonText}>{t('groupMembersSheet.addMembers')}</Text>
            </TouchableOpacity>
          ) : null}
        </BottomSheetScrollView>
      </BottomSheetModal>

      <FriendPickerSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handlePickerSelect}
        title={t('groupMembersSheet.addMembers')}
        subtitle={t('groupMembersSheet.pickFriendSubtitle')}
        excludePubkeys={group.memberPubkeys}
      />
    </>
  );
};

export default GroupMembersSheet;
