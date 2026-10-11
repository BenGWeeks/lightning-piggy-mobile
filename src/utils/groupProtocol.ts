import type { Group } from '../types/groups';
import type { DmProtocol } from './dmProtocol';

/** A group's transport, fixed at creation: Marmot (MLS) groups carry
 * `protocol: 'marmot'`; an absent field means a NIP-17 group. Shared by the
 * Messages-list row tag and the group chat header so the two always agree. */
export function groupDmProtocol(group: Pick<Group, 'protocol'>): DmProtocol {
  return group.protocol ?? 'nip17';
}
