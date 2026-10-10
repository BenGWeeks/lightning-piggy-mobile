// AsyncStorage key layout for group-chat history (#1240 — see
// groupMessagesMigration.ts for the upgrade path).
//
//   group_messages_<owner>:<groupId>   per-account history (current)
//   group_messages_<groupId>           legacy device-wide blob (pre-#1240)
//
// `owner` is the signed-in account's lowercase 64-hex pubkey. The separator
// can't collide: no group id is a bare 64-hex string followed by ':' (ids are
// `g_…` kind-30200, `s_<sha256>` synthetic NIP-17 rooms, or
// `marmot:<mls id>`), so OWNED_KEY splits every key unambiguously — and a
// legacy key never matches it.
export const GROUP_MESSAGES_KEY_PREFIX = 'group_messages_';

const OWNER_RE = /^[0-9a-f]{64}$/;
const OWNED_KEY = /^group_messages_[0-9a-f]{64}:/;

/** Lowercased owner pubkey, or null when it isn't a 64-hex pubkey. */
export function normaliseGroupOwner(owner: string | null | undefined): string | null {
  const pk = owner?.toLowerCase() ?? '';
  return OWNER_RE.test(pk) ? pk : null;
}

/** Every key belonging to one owner starts with this. */
export function groupMessagesOwnerPrefix(owner: string): string {
  return `${GROUP_MESSAGES_KEY_PREFIX}${owner}:`;
}

export function groupMessagesKey(owner: string, groupId: string): string {
  return `${groupMessagesOwnerPrefix(owner)}${groupId}`;
}

/** The pre-#1240 device-wide key for a group. */
export function legacyGroupMessagesKey(groupId: string): string {
  return `${GROUP_MESSAGES_KEY_PREFIX}${groupId}`;
}

/** Group id of a legacy (unowned) key, or null for owned / unrelated keys. */
export function legacyGroupIdFromKey(key: string): string | null {
  if (!key.startsWith(GROUP_MESSAGES_KEY_PREFIX) || OWNED_KEY.test(key)) return null;
  const groupId = key.slice(GROUP_MESSAGES_KEY_PREFIX.length);
  return groupId.length > 0 ? groupId : null;
}
