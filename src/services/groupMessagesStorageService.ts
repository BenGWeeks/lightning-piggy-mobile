import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * In-thread message stored locally, per-group. We persist what the user
 * has sent so the UI can re-render after relaunch even before the inbound
 * NIP-17 receive-side routing for groups lands (tracked as a follow-up
 * to PR #227).
 */
export interface GroupMessage {
  /** Stable id; for self-sent messages we use a generated wrap id. */
  id: string;
  /** Pubkey of the sender (lowercase hex). */
  senderPubkey: string;
  /** Text payload as authored (preserves casing); empty for system events. */
  text: string;
  /** Unix seconds — same convention as nostr `created_at`. */
  createdAt: number;
}

// Account scoping: keyed only by groupId, not by viewer pubkey. These
// blobs hold decrypted group-chat plaintext, so to prevent a cross-account
// privacy leak NostrContext.wipeAccountCaches scans AsyncStorage for keys
// with the GROUP_MESSAGES_KEY_PREFIX and removes them on logout / account
// wipe. Per-account namespacing tracked as a follow-up alongside
// multi-account switching.
export const GROUP_MESSAGES_KEY_PREFIX = 'group_messages_';
const KEY = (groupId: string): string => `${GROUP_MESSAGES_KEY_PREFIX}${groupId}`;
const CAP = 500;

export async function loadGroupMessages(groupId: string): Promise<GroupMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY(groupId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as GroupMessage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Window in seconds for matching an inbound real-event message against a
// pending optimistic local_* row (same sender + same text). Closes #402:
// without this, the sender's own NIP-17 self-wrap echo arrives with the
// gift-wrap hex id, which never collides with the local_<ts>_<rnd> id we
// optimistically appended on send — so both rows persisted and the user
// saw the same message (e.g. a GIF) twice.
const LOCAL_ECHO_MATCH_WINDOW_SECS = 30;

export async function appendGroupMessage(
  groupId: string,
  message: GroupMessage,
): Promise<GroupMessage[]> {
  const existing = await loadGroupMessages(groupId);
  const map = new Map<string, GroupMessage>();
  for (const m of existing) map.set(m.id, m);

  // When a real (non-local_) event arrives, look for a pending optimistic
  // local_* row from the same sender with identical text and a close-enough
  // createdAt — and replace it with the real one rather than appending
  // alongside. Pick the closest createdAt match so back-to-back identical
  // sends are matched in order even when relay echoes arrive out-of-order.
  // senderPubkey is lowercased on both sides because inbound rumors are
  // lowercased upstream while optimistic locals may use the viewer pubkey
  // as-is.
  if (!message.id.startsWith('local_')) {
    const targetSender = message.senderPubkey.toLowerCase();
    let bestKey: string | null = null;
    let bestDelta = Infinity;
    for (const [k, m] of map) {
      if (!k.startsWith('local_')) continue;
      if (m.senderPubkey.toLowerCase() !== targetSender) continue;
      if (m.text !== message.text) continue;
      const delta = Math.abs(m.createdAt - message.createdAt);
      if (delta > LOCAL_ECHO_MATCH_WINDOW_SECS) continue;
      if (delta < bestDelta) {
        bestDelta = delta;
        bestKey = k;
      }
    }
    if (bestKey !== null) map.delete(bestKey);
  }

  // Dedup on id; keep the newer copy when ids collide (createdAt wins).
  const prior = map.get(message.id);
  if (!prior || prior.createdAt < message.createdAt) {
    map.set(message.id, message);
  }
  const all = Array.from(map.values()).sort((a, b) => a.createdAt - b.createdAt);
  const capped = all.length <= CAP ? all : all.slice(all.length - CAP);
  await AsyncStorage.setItem(KEY(groupId), JSON.stringify(capped));
  return capped;
}

export async function clearGroupMessages(groupId: string): Promise<void> {
  await AsyncStorage.removeItem(KEY(groupId));
}

/**
 * Remove a single message row by id. Used by the group send failure path
 * (#1033) to retract the optimistic `local_*` row that was painted before
 * signing — mirrors the 1:1 path's "keep the bubble on failure" semantics
 * adapted for group storage: we show a BrandedAlert AND remove the row so
 * a never-published message doesn't linger in the thread. Returns the
 * updated message list on success (the unmodified list, unchanged, if
 * `messageId` wasn't found).
 *
 * On an AsyncStorage read/write error this REJECTS rather than returning
 * `[]` — matching `appendGroupMessage`'s propagate-on-failure contract
 * elsewhere in this module (and `identitiesStore`'s write-through
 * functions). A transient storage error must never be conflated with "the
 * thread is now empty": a caller that unconditionally did
 * `setMessages(await removeGroupMessage(...))` would otherwise wipe the
 * visible thread on a blip that touched none of the underlying data.
 * Callers MUST catch and treat a rejection as "the row could not be
 * retracted from local storage" — leave any optimistic in-memory removal
 * as-is and do not call setMessages with this function's result.
 */
export async function removeGroupMessage(
  groupId: string,
  messageId: string,
): Promise<GroupMessage[]> {
  const existing = await loadGroupMessages(groupId);
  const filtered = existing.filter((m) => m.id !== messageId);
  await AsyncStorage.setItem(KEY(groupId), JSON.stringify(filtered));
  return filtered;
}

// Scan AsyncStorage for every blob under GROUP_MESSAGES_KEY_PREFIX and return
// the set of message ids that look like NIP-17 wrap ids (64-char hex —
// `local_*` optimistic rows are excluded). Used by NostrContext to
// pre-seed `knownWrapIds` on cold start so the live DM sub doesn't
// redundantly decrypt + re-route group wraps it already processed in
// a previous session. Single AsyncStorage round-trip per stored group.
const WRAP_ID_PATTERN = /^[0-9a-f]{64}$/;
export async function listPersistedGroupWrapIds(): Promise<string[]> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const groupKeys = keys.filter((k) => k.startsWith(GROUP_MESSAGES_KEY_PREFIX));
    if (groupKeys.length === 0) return [];
    const pairs = await AsyncStorage.multiGet(groupKeys);
    const ids: string[] = [];
    for (const [, raw] of pairs) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as GroupMessage[];
        if (!Array.isArray(parsed)) continue;
        for (const m of parsed) {
          if (typeof m.id === 'string' && WRAP_ID_PATTERN.test(m.id)) ids.push(m.id);
        }
      } catch {
        // Skip malformed blob — better than aborting the whole scan.
      }
    }
    return ids;
  } catch {
    return [];
  }
}
