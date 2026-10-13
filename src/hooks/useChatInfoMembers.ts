import { useMemo } from 'react';
import { useNostr, useNostrContacts } from '../contexts/NostrContext';
import type { Group } from '../types/groups';
import {
  buildGroupMemberRows,
  type GroupMemberRow,
  type MemberProfile,
} from '../utils/groupMemberRows';
const EMPTY: GroupMemberRow[] = [];
/** Reconcile the snapshot with live membership edits without a second relay subscription. */
export function useChatInfoMembers(group: Group | undefined, snapshot: GroupMemberRow[] = EMPTY) {
  const { pubkey, profile } = useNostr();
  const { contacts } = useNostrContacts();
  return useMemo(() => {
    if (!group) return EMPTY;
    const profiles = new Map<string, MemberProfile>(
      snapshot.map((m) => [m.pubkey, { name: m.name, displayName: m.name, picture: m.picture }]),
    );
    return buildGroupMemberRows({
      memberPubkeys: group.memberPubkeys,
      selfPubkey: pubkey,
      selfProfile: profile,
      contacts,
      profiles,
    });
  }, [group, snapshot, pubkey, profile, contacts]);
}
