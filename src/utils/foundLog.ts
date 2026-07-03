import type { VerifiedEvent } from 'nostr-tools';
import { sanitizeDisplayText } from './sanitizeDisplayText';

/**
 * A parsed NIP-GC **found-log** (kind 7516) — a finder's note on a cache,
 * flattened from the raw Nostr event into the shape the detail screen and
 * its log row render.
 *
 * Extracted from `HuntPiggyDetailScreen` (which sits at its size-cap
 * baseline) so the pure event→object shaping is independently testable and
 * the screen stays composition (CLAUDE.md → File size and modularity).
 */
export type FoundLog = {
  id: string;
  pubkey: string;
  createdAt: number;
  content: string;
  imageUrl: string | null;
  amountSats: number | null;
};

export function parseFoundLog(e: VerifiedEvent): FoundLog {
  const tag = (k: string): string | undefined => e.tags.find((t) => t[0] === k)?.[1];
  const amt = parseInt(tag('amount') ?? '', 10);
  return {
    id: e.id,
    pubkey: e.pubkey,
    createdAt: e.created_at,
    // Strip orphaned object-replacement / zero-width placeholders so an
    // inline-attachment artifact in the finder's note doesn't render as a
    // tofu box (#764).
    content: sanitizeDisplayText(e.content),
    imageUrl: tag('image') ?? null,
    amountSats: Number.isFinite(amt) && amt > 0 ? amt : null,
  };
}
