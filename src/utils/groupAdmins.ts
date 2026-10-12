import type { Group } from '../types/groups';

/**
 * Pure helpers for a Marmot group's admin set (MIP-01 `admin_pubkeys`, the
 * `marmot.group.admin-policy.v1` component). The spec requires the list to be
 * non-empty, unique and limited to current members; marmot-ts sorts + dedups
 * on encode, so these helpers only own the app-level rules: case-insensitive
 * matching and never leaving a group without an admin.
 */

/** Thrown when an admin change would leave the group with no admin. */
export class LastAdminError extends Error {
  constructor() {
    super('marmot: a group must keep at least one admin');
    this.name = 'LastAdminError';
  }
}

const norm = (pk: string) => pk.toLowerCase();

/** Lower-cased, de-duplicated, in first-seen order. */
export function normaliseAdmins(admins: readonly string[]): string[] {
  return [...new Set(admins.map(norm))];
}

export function isGroupAdmin(admins: readonly string[] | undefined, pubkey: string): boolean {
  if (!admins) return false;
  const pk = norm(pubkey);
  return admins.some((a) => norm(a) === pk);
}

/** Whether the viewer may rename the group or change its members. NIP-17
 * groups are editable by anyone; a Marmot group only by its admins, because
 * MLS rejects a non-admin's commit. A group that hasn't loaded yet is treated
 * as editable (nothing to act on). */
export function canManageGroup(
  group: Pick<Group, 'protocol' | 'adminPubkeys'> | undefined,
  selfPubkey: string | null | undefined,
): boolean {
  if (!group?.protocol) return true;
  return !!selfPubkey && isGroupAdmin(group.adminPubkeys, selfPubkey);
}

/**
 * Whether `pubkey` can be removed as admin: they must be one, and someone else
 * must remain (MIP-03: an update that removes the committer is valid only if
 * another admin remains — and an empty admin list is invalid outright).
 */
export function canRemoveAdmin(admins: readonly string[] | undefined, pubkey: string): boolean {
  if (!admins || !isGroupAdmin(admins, pubkey)) return false;
  return normaliseAdmins(admins).length > 1;
}

/** The admin set after promoting / demoting `pubkey`. Throws LastAdminError
 * rather than return an empty set. */
export function buildAdminUpdate(
  admins: readonly string[],
  pubkey: string,
  action: 'add' | 'remove',
): string[] {
  const current = normaliseAdmins(admins);
  const pk = norm(pubkey);
  if (action === 'add') return current.includes(pk) ? current : [...current, pk];
  const next = current.filter((a) => a !== pk);
  if (next.length === 0) throw new LastAdminError();
  return next;
}
