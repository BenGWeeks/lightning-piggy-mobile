import { getConversationForEvent } from './dmDb';
import { protocolForWireKind } from '../utils/dmProtocol';

export interface ResolvedConversation {
  pubkey: string;
  protocol: 'nip04' | 'nip17';
}

type Lookup = (
  owner: string,
  eventId: string,
) => Promise<{ conversation: string; wireKind: number } | null>;

/**
 * The conversation a NIP-17 gift wrap belongs to (#1154). A message alert the
 * background couldn't decrypt carries only the wrap id; once the app has
 * decrypted and stored that wrap (inbox refresh / live sub after the tap), its
 * row names the conversation. Polls until then, up to `timeoutMs`; null if it
 * never appears (e.g. decryption was declined).
 */
export async function resolveWrapConversation(
  owner: string,
  wrapId: string,
  {
    timeoutMs = 20_000,
    intervalMs = 750,
    lookup = getConversationForEvent,
    shouldStop = () => false,
  }: {
    timeoutMs?: number;
    intervalMs?: number;
    lookup?: Lookup;
    /** True once the result is no longer wanted (the user moved on). */
    shouldStop?: () => boolean;
  } = {},
): Promise<ResolvedConversation | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (shouldStop()) return null;
    const row = await lookup(owner, wrapId).catch(() => null);
    if (row) return { pubkey: row.conversation, protocol: protocolForWireKind(row.wireKind) };
    if (Date.now() + intervalMs > deadline) return null;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * A "the user moved on" check for a pending navigation to `routeName`: false
 * until that route has actually been focused (navigate() lands a moment
 * later), then true once the user leaves it.
 */
export function leftAfterReaching(
  currentRouteName: () => string | undefined,
  routeName: string,
): () => boolean {
  let reached = false;
  return () => {
    const onRoute = currentRouteName() === routeName;
    if (onRoute) reached = true;
    return reached && !onRoute;
  };
}
