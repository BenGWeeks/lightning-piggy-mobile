export type DmProtocol = 'nip04' | 'nip17' | 'marmot';

export const DEFAULT_DM_PROTOCOL: DmProtocol = 'nip17';
export const DM_PROTOCOL_LABEL: Record<DmProtocol, string> = {
  nip04: 'NIP-04',
  nip17: 'NIP-17',
  marmot: 'Marmot',
};

export function protocolForWireKind(wireKind: number | undefined): 'nip04' | 'nip17' {
  return wireKind === 4 ? 'nip04' : 'nip17';
}

/** Read-side thread partition; preserves message order and object identity. */
export function filterMessagesByProtocol<T extends { wireKind?: number }>(
  messages: readonly T[],
  protocol: DmProtocol,
): T[] {
  return messages.filter((message) => protocolForWireKind(message.wireKind) === protocol);
}

/** Notification / active-thread identity for a 1:1 conversation. Threads are
 * split per protocol, so viewing one protocol must not silence the other. */
export function dmThreadId(pubkey: string, protocol: DmProtocol): string {
  return `${pubkey.toLowerCase()}:${protocol}`;
}

/** Thread identity of a stored DM — matches the inbox summary row id. */
export function dmMessageThreadId(message: { partnerPubkey: string; wireKind?: number }): string {
  return dmThreadId(message.partnerPubkey, protocolForWireKind(message.wireKind));
}

export function isDmProtocolAvailable(protocol: DmProtocol): boolean {
  return protocol !== 'marmot';
}

/** Marmot (MLS group chat over Nostr, e.g. White Noise) inner kinds: 443
 * KeyPackage, 444 Welcome (a group invite, delivered gift-wrapped like a
 * NIP-17 DM), 445 Group Event. The app can't read them yet (#1140). */
export const MARMOT_WELCOME_KIND = 444;
export function isMarmotKind(kind: number | undefined): boolean {
  return kind === 443 || kind === MARMOT_WELCOME_KIND || kind === 445;
}

/** i18n key for a Marmot message's "not supported yet" bubble, else null. */
export function marmotBubbleKey(kind: number): string | null {
  if (!isMarmotKind(kind)) return null;
  return kind === MARMOT_WELCOME_KIND
    ? 'messageBubble.marmotInvite'
    : 'messageBubble.marmotMessage';
}
