import {
  preferredConversationParams,
  type DirectChatTarget,
} from '../services/preferredDmProtocol';
import type { RootStackParamList } from '../navigation/types';

/** Anything that can push the root-stack Conversation route. */
export interface ConversationNavigator {
  navigate(screen: 'Conversation', params: RootStackParamList['Conversation']): void;
}

/**
 * Open a 1:1 chat with a person (rather than a specific existing thread):
 * Marmot when the peer can receive it, else NIP-17, decided by the same
 * cached, timeout-bounded lookup the send path uses — so the screen opens on
 * the right thread instead of opening NIP-17 and switching. Accounts without
 * a Marmot session (incl. Amber / NIP-46 before it starts) resolve to NIP-17
 * immediately, without touching the signer.
 *
 * Double taps are safe: concurrent calls share the in-flight lookup, so they
 * navigate with identical params and the Conversation route's getId (one
 * screen per protocol thread) reuses the first screen instead of pushing a
 * second.
 */
export async function openDirectChat(
  navigation: ConversationNavigator,
  viewer: string | null,
  target: DirectChatTarget,
): Promise<void> {
  navigation.navigate('Conversation', await preferredConversationParams(viewer, target));
}
