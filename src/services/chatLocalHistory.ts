import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ChatClearBoundary {
  at: number;
  /** Already-loaded messages at or beyond local time must stay cleared on replay. */
  hidden: { id: string; createdAt: number }[];
}

/** Per-account, per-protocol local clear boundary. No deletion event is sent. */
export const chatHistoryKey = (owner: string, thread: string) =>
  `chat_clear_v1:${owner.toLowerCase()}:${thread}`;
export async function loadChatClearBoundary(
  owner: string,
  thread: string,
): Promise<ChatClearBoundary> {
  const raw = await AsyncStorage.getItem(chatHistoryKey(owner, thread));
  try {
    const value = JSON.parse(raw ?? '0');
    // Read the original numeric cutoff format as well.
    const at = typeof value === 'number' ? value : value?.at;
    if (!Number.isFinite(at) || at <= 0) return { at: 0, hidden: [] };
    const hidden = Array.isArray(value?.hidden)
      ? value.hidden.filter(
          (entry: { id?: unknown; createdAt?: unknown }) =>
            typeof entry?.id === 'string' &&
            typeof entry.createdAt === 'number' &&
            Number.isFinite(entry.createdAt) &&
            entry.createdAt >= at,
        )
      : [];
    return { at, hidden };
  } catch {
    return { at: 0, hidden: [] };
  }
}
export async function saveChatClearBoundary(
  owner: string,
  thread: string,
  boundary: ChatClearBoundary,
) {
  await AsyncStorage.setItem(chatHistoryKey(owner, thread), JSON.stringify(boundary));
}
