import AsyncStorage from '@react-native-async-storage/async-storage';
/** Per-account, per-protocol local clear boundary. Delayed relay replays stay hidden;
 * new messages remain visible. No deletion event is sent to other participants. */
export const chatHistoryKey = (owner: string, thread: string) =>
  `chat_clear_v1:${owner.toLowerCase()}:${thread}`;
export async function loadChatClearBoundary(owner: string, thread: string): Promise<number> {
  const raw = await AsyncStorage.getItem(chatHistoryKey(owner, thread));
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
export async function saveChatClearBoundary(owner: string, thread: string, boundary: number) {
  await AsyncStorage.setItem(chatHistoryKey(owner, thread), String(boundary));
}
