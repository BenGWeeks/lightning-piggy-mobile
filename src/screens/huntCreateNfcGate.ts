/**
 * Pure gate for the Hide-a-Piglet Step 6 "Write to NFC tag" affordance.
 *
 * A reward LNURL is always sufficient to write a tag. But a no-prize
 * public cache (#954/#955) has an empty LNURL by design and must still
 * get a physical tag: the 2-record hunt payload (LP deep link +
 * `nostr:naddr`) is written via `writeHuntTagToTag`, which treats the
 * LNURL record as optional. So a public listing with the hider's pubkey
 * can write even with no LNURL.
 *
 * Only the private single-record path (`writeLnurlToTag`) genuinely
 * needs an LNURL — a private, no-LNURL listing therefore stays gated.
 *
 * Extracted from HuntCreateScreen so the branch logic is unit-testable
 * without rendering the full wizard.
 */
export function canWriteHuntTag(args: {
  /** Reward LNURL as entered in the wizard (may be untrimmed/empty). */
  lnurl: string;
  /** Whether the cache is being published to relays (kind 37516). */
  isPublic: boolean;
  /** The hider's Nostr pubkey, if logged in — needed for the naddr. */
  pubkey: string | null | undefined;
}): boolean {
  const hasLnurl = Boolean(args.lnurl.trim());
  const canWritePublicPayload = args.isPublic && Boolean(args.pubkey);
  return hasLnurl || canWritePublicPayload;
}
