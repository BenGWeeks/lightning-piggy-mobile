import React, { useMemo, useCallback } from 'react';
import { useNostr, useNostrContacts } from '../contexts/NostrContext';
import GroupMembersSheet from './GroupMembersSheet';
import { buildGroupMemberRows, type MemberProfile } from '../utils/groupMemberRows';

const NO_PROFILES: ReadonlyMap<string, MemberProfile> = new Map();

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The other person, as the thread header shows them. */
  peer: { pubkey: string; name: string; picture: string | null };
  /** The 1:1's MLS group id (hex). */
  chatId: string | null;
  deviceCounts: ReadonlyMap<string, number> | null;
  onMemberTap?: (pubkey: string) => void;
}

/**
 * Who's in a Marmot 1:1 and on which devices (#1267): the shared members
 * sheet, read-only, with both people's device lists open. Opened from the
 * thread header's "Secure chat · 2 devices" by-line.
 */
const DmMembersSheet: React.FC<Props> = ({
  visible,
  onClose,
  peer,
  chatId,
  deviceCounts,
  onMemberTap,
}) => {
  const { pubkey: selfPubkey, profile } = useNostr();
  const { contacts } = useNostrContacts();
  const { pubkey, name, picture } = peer;
  const members = useMemo(
    () =>
      buildGroupMemberRows({
        memberPubkeys: [pubkey],
        selfPubkey,
        selfProfile: profile,
        contacts,
        profiles: NO_PROFILES,
      }).map((row) =>
        // Same name / picture as the thread header.
        row.isSelf ? row : { ...row, name: name || row.name, picture: picture ?? row.picture },
      ),
    [pubkey, name, picture, selfPubkey, profile, contacts],
  );
  const openMember = useCallback(
    (pubkey: string) => {
      onClose();
      onMemberTap?.(pubkey);
    },
    [onClose, onMemberTap],
  );
  return (
    <GroupMembersSheet
      visible={visible}
      groupId={null}
      readOnly
      onClose={onClose}
      members={members}
      onMemberTap={onMemberTap ? openMember : undefined}
      chatId={chatId}
      deviceCounts={deviceCounts}
      expandDevices
    />
  );
};

export default DmMembersSheet;
