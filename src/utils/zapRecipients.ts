/**
 * Recipient pubkeys for the incoming-zap `#p` filter: the user's own Nostr
 * pubkey plus the LNURL server's `nostrPubkey` for the wallet's lightning
 * address (self-hosted LNbits tags zap receipts with the server's pubkey, not
 * the user's).
 *
 * The caller awaits this only AFTER the zap resolver's pending/fingerprint
 * short-circuits, so the common no-op balance tick (nothing new to attribute)
 * never pays the `resolveLud16ToNostrPubkey` network round-trip — that
 * round-trip on every balance poll was part of the #828 tap-window contention.
 */
export async function collectZapRecipientPubkeys(
  userPubkey: string | null,
  lightningAddress: string | null | undefined,
  resolveLud16ToNostrPubkey: (lud16: string) => Promise<string | null>,
): Promise<string[]> {
  const recipients: string[] = [];
  if (userPubkey) recipients.push(userPubkey);
  if (lightningAddress) {
    const pk = await resolveLud16ToNostrPubkey(lightningAddress);
    if (pk) recipients.push(pk);
  }
  return recipients;
}
