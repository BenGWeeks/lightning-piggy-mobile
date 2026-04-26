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
  /** Lowercased text payload (or empty for system events). */
  text: string;
  /** Unix seconds — same convention as nostr `created_at`. */
  createdAt: number;
}

const KEY = (groupId: string): string => `group_messages_${groupId}`;
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

export async function appendGroupMessage(
  groupId: string,
  message: GroupMessage,
): Promise<GroupMessage[]> {
  const existing = await loadGroupMessages(groupId);
  // Dedup on id; keep the newer copy when ids collide (createdAt wins).
  const map = new Map<string, GroupMessage>();
  for (const m of existing) map.set(m.id, m);
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
