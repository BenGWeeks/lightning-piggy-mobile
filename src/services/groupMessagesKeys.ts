// AsyncStorage key layout for group-chat history (#1240 — see
// groupMessagesMigration.ts for the upgrade path).
//
//   group_history_<owner>:<groupId>    per-account history (current)
//   group_messages_<groupId>           legacy device-wide blob (pre-#1240)
//
// `owner` is the signed-in account's lowercase 64-hex pubkey, so everything
// after the fixed-length owner + ':' is the group id. The two layouts use
// DIFFERENT prefixes on purpose: group ids are not ours to constrain (a
// kind-30200 `d` tag comes off a relay), so any per-account key nested under
// `group_messages_` could be impersonated by a crafted legacy id such as
// `<someone's pubkey>:g_room`. With disjoint prefixes no legacy key can ever
// be read, migrated or wiped as another account's history.
export const GROUP_MESSAGES_KEY_PREFIX = 'group_messages_';
export const GROUP_HISTORY_KEY_PREFIX = 'group_history_';

const OWNER_RE = /^[0-9a-f]{64}$/;

/** Lowercased owner pubkey, or null when it isn't a 64-hex pubkey. */
export function normaliseGroupOwner(owner: string | null | undefined): string | null {
  const pk = owner?.toLowerCase() ?? '';
  return OWNER_RE.test(pk) ? pk : null;
}

/** Every key belonging to one owner starts with this. */
export function groupMessagesOwnerPrefix(owner: string): string {
  return `${GROUP_HISTORY_KEY_PREFIX}${owner}:`;
}

export function groupMessagesKey(owner: string, groupId: string): string {
  return `${groupMessagesOwnerPrefix(owner)}${groupId}`;
}

/** The pre-#1240 device-wide key for a group. */
export function legacyGroupMessagesKey(groupId: string): string {
  return `${GROUP_MESSAGES_KEY_PREFIX}${groupId}`;
}

/** Group id of a legacy (device-wide) key, or null for any other key. */
export function legacyGroupIdFromKey(key: string): string | null {
  if (!key.startsWith(GROUP_MESSAGES_KEY_PREFIX)) return null;
  const groupId = key.slice(GROUP_MESSAGES_KEY_PREFIX.length);
  return groupId.length > 0 ? groupId : null;
}
