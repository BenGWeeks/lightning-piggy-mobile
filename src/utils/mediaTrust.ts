// Trust gating for automatic network requests from chat messages (#1338).
//
// A message's link preview, image or voice note makes the phone contact a
// URL the AUTHOR chose — revealing the reader's IP and read time, and (via
// DNS rebinding, which `publicUrl.ts` can't stop client-side) potentially
// probing their LAN. So media loads automatically only for messages the
// reader wrote or that come from someone they follow (their kind-3 contact
// list). Everyone else gets a tap-to-load placeholder.
//
// Decided PER SENDER, never per chat: in a group, a stranger's message stays
// gated even when the group also contains people you follow.

/** Lower-cased set of followed pubkeys, for O(1) per-row lookups. */
export function buildFollowedSet(contacts: readonly { pubkey: string }[]): Set<string> {
  const set = new Set<string>();
  for (const c of contacts) if (c.pubkey) set.add(c.pubkey.toLowerCase());
  return set;
}

/**
 * Should media in this message load without a tap? True for my own messages
 * and for senders I follow; false for everyone else, including an unknown
 * sender (fail closed).
 */
export function canAutoLoadMedia(
  fromMe: boolean,
  senderPubkey: string | null | undefined,
  followed: ReadonlySet<string>,
): boolean {
  if (fromMe) return true;
  if (!senderPubkey) return false;
  return followed.has(senderPubkey.toLowerCase());
}

/** Stored group messages have no fromMe flag; derive it from the active account. */
export function canAutoLoadChatMedia(
  fromMe: boolean | undefined,
  senderPubkey: string,
  followed: ReadonlySet<string>,
  owner: string | null | undefined,
): boolean {
  return canAutoLoadMedia(
    fromMe ?? (!!owner && senderPubkey.toLowerCase() === owner.toLowerCase()),
    senderPubkey,
    followed,
  );
}
