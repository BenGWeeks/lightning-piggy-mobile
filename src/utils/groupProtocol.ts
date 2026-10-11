import type { Group } from '../types/groups';
import type { DmProtocol } from './dmProtocol';

/** A group's transport, fixed at creation: Marmot (MLS) groups carry
 * `protocol: 'marmot'`; an absent field means a NIP-17 group. Shared by the
 * Messages-list row tag and the group chat header so the two always agree. */
export function groupDmProtocol(group: Pick<Group, 'protocol'>): DmProtocol {
  return group.protocol ?? 'nip17';
}

/** Whether the viewer may rename the group or change its members. NIP-17
 * groups are editable by anyone; a Marmot group only by its admins, because
 * MLS rejects a non-admin's commit. A group that hasn't loaded yet is treated
 * as editable (nothing to act on). Pubkeys compare case-insensitively. */
export function canManageGroup(
  group: Pick<Group, 'protocol' | 'adminPubkeys'> | undefined,
  selfPubkey: string | null | undefined,
): boolean {
  if (!group?.protocol) return true;
  if (!selfPubkey) return false;
  const me = selfPubkey.toLowerCase();
  return (group.adminPubkeys ?? []).some((pk) => pk.toLowerCase() === me);
}
