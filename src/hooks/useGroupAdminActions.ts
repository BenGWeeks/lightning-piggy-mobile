import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert as BrandedAlert } from '../components/BrandedAlert';
import Toast from '../components/BrandedToast';
import { useGroups } from '../contexts/GroupsContext';
import { useTranslation } from '../contexts/LocaleContext';
import { marmotSendError } from '../services/marmotSend';
import type { Group } from '../types/groups';
import { buildAdminUpdate, canRemoveAdmin, isGroupAdmin } from '../utils/groupAdmins';
import type { GroupMemberRow } from '../utils/groupMemberRows';

/**
 * The members sheet's "⋯" admin menu for a Marmot group: Make admin / Remove
 * as admin, each confirmed with the branded Alert, committed as one MLS
 * admin-policy update. Admin changes are single-flight — each is a commit
 * built on the current admin set, so two concurrent ones would race.
 *
 * Callers only offer the menu to admins of a multi-member Marmot group
 * (1:1 DMs never reach the members sheet).
 */
export function useGroupAdminActions(group: Group | undefined) {
  const t = useTranslation();
  const { setGroupAdmins } = useGroups();
  const [pendingPubkey, setPendingPubkey] = useState<string | null>(null);
  const inFlight = useRef(false);
  const groupId = group?.id;
  const admins = group?.adminPubkeys;
  // The confirm dialog outlives the render that opened it: build the update
  // from the admin set as it is when the user confirms, not when they tapped.
  const latestAdmins = useRef(admins);
  useEffect(() => {
    latestAdmins.current = admins;
  }, [admins]);

  const commit = useCallback(
    async (m: GroupMemberRow, action: 'add' | 'remove') => {
      const current = latestAdmins.current;
      if (!groupId || !current || inFlight.current) return;
      inFlight.current = true;
      setPendingPubkey(m.pubkey);
      try {
        await setGroupAdmins(groupId, buildAdminUpdate(current, m.pubkey, action));
        Toast.show({
          type: 'success',
          text1: t(
            action === 'add'
              ? 'groupMembersSheet.madeAdminToast'
              : m.isSelf
                ? 'groupMembersSheet.youRemovedAdminToast'
                : 'groupMembersSheet.removedAdminToast',
            { name: m.name },
          ),
        });
      } catch (e) {
        if (__DEV__) console.warn('[Group] admin change failed:', e);
        BrandedAlert.alert(t('groupMembersSheet.adminChangeFailedTitle'), marmotSendError(e));
      } finally {
        inFlight.current = false;
        setPendingPubkey(null);
      }
    },
    [groupId, setGroupAdmins, t],
  );

  const confirmMakeAdmin = useCallback(
    (m: GroupMemberRow) =>
      BrandedAlert.alert(
        t('groupMembersSheet.makeAdminTitle', { name: m.name }),
        t('groupMembersSheet.makeAdminMessage'),
        [
          { text: t('groupMembersSheet.cancel'), style: 'cancel' },
          { text: t('groupMembersSheet.makeAdmin'), onPress: () => void commit(m, 'add') },
        ],
      ),
    [commit, t],
  );

  const confirmRemoveAdmin = useCallback(
    (m: GroupMemberRow) => {
      if (!canRemoveAdmin(admins, m.pubkey)) {
        BrandedAlert.alert(
          t('groupMembersSheet.lastAdminTitle'),
          t('groupMembersSheet.lastAdminMessage'),
        );
        return;
      }
      BrandedAlert.alert(
        m.isSelf
          ? t('groupMembersSheet.removeSelfAdminTitle')
          : t('groupMembersSheet.removeAdminTitle', { name: m.name }),
        m.isSelf
          ? t('groupMembersSheet.removeSelfAdminMessage')
          : t('groupMembersSheet.removeAdminMessage', { name: m.name }),
        [
          { text: t('groupMembersSheet.cancel'), style: 'cancel' },
          {
            text: t('groupMembersSheet.removeAdmin'),
            style: 'destructive',
            onPress: () => void commit(m, 'remove'),
          },
        ],
      );
    },
    [admins, commit, t],
  );

  /** "⋯" on a member row: the one admin action that applies to them. */
  const openAdminActions = useCallback(
    (m: GroupMemberRow) => {
      const memberIsAdmin = isGroupAdmin(admins, m.pubkey);
      BrandedAlert.alert(
        m.name,
        undefined,
        [
          memberIsAdmin
            ? {
                text: t('groupMembersSheet.removeAdmin'),
                style: 'destructive',
                testID: 'group-member-remove-admin',
                onPress: () => confirmRemoveAdmin(m),
              }
            : {
                text: t('groupMembersSheet.makeAdmin'),
                testID: 'group-member-make-admin',
                onPress: () => confirmMakeAdmin(m),
              },
          { text: t('groupMembersSheet.cancel'), style: 'cancel' },
        ],
        { cancelable: true },
      );
    },
    [admins, confirmMakeAdmin, confirmRemoveAdmin, t],
  );

  return { adminPendingPubkey: pendingPubkey, openAdminActions };
}
