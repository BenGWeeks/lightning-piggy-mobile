import * as nip19 from 'nostr-tools/nip19';

/**
 * Render a hex pubkey as a short, recognisable npub1-prefix display
 * string when we don't have a kind 0 profile to fall back on.
 *
 * Example output: `npub1abcde…xyz123`
 *
 * Most Nostr clients (Damus, Primal, Snort, Iris) show npub-style
 * shortenings rather than raw hex when an author has never published
 * a profile event — it's the closest thing to a portable identifier.
 * The hex shorty (`b5ce7bd9…146e`) reads as gibberish to non-techy
 * users and looks indistinguishable from any other 64-char blob.
 *
 * Falls back to a hex shorty only if nip19.npubEncode throws (which
 * it shouldn't for a valid 64-char hex pubkey — but the parser is
 * strict, so we don't want to crash the row).
 */
export const shortNpub = (pubkey: string): string => {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 12)}…${npub.slice(-6)}`;
  } catch {
    return `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
  }
};
