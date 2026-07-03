// Pure helpers for the `nostr:npub…` / `nostr:nprofile…` deep-link + NFC
// read path (#754). Kept free of React / navigation so the decode + shape
// logic is unit-testable in isolation; App.tsx wires these into the
// Linking handler and the navigation ref.
import type { ContactProfileBodyData } from '../components/ContactProfileBody';
import type { NostrProfile } from '../types/nostr';
import { npubEncode } from '../services/nostrService';

// Matches a NIP-21 `nostr:` URI carrying an npub or nprofile, OR a bare
// `npub1…` / `nprofile1…` bech32 with no scheme. Case-insensitive on the
// scheme (NIP-21 allows `NOSTR:` etc.); bech32 bodies are always lower
// hrp + data. We only claim profile references here — `naddr` (Hunt
// listings) is handled by its own branch, and `note` / `nevent` route to
// the UnsupportedEntity fallback so the caller can tell them apart.
const PROFILE_URI_RE = /^(?:nostr:)?(npub1[0-9a-z]+|nprofile1[0-9a-z]+)$/i;

/**
 * True when `raw` is a `nostr:` profile reference (npub or nprofile),
 * with or without the `nostr:` scheme prefix. Used by the deep-link
 * router to claim the URI before falling through to lightning:/hunt
 * branches.
 */
export function isProfileReferenceUri(raw: string): boolean {
  return PROFILE_URI_RE.test(raw.trim());
}

/**
 * Project a fetched kind-0 `NostrProfile` into the `ContactProfileBodyData`
 * shape the ContactProfile route consumes. Prefers display name → name →
 * a truncated npub so the header never renders empty.
 */
export function profileToContactBody(profile: NostrProfile): ContactProfileBodyData {
  const npub = profile.npub || npubEncode(profile.pubkey);
  return {
    pubkey: profile.pubkey,
    name: profile.displayName || profile.name || `${npub.slice(0, 12)}…`,
    picture: profile.picture ?? null,
    banner: profile.banner ?? null,
    nip05: profile.nip05 ?? null,
    about: profile.about ?? null,
    lightningAddress: profile.lud16 ?? null,
    source: 'nostr',
  };
}

/**
 * Minimal pubkey-only stub for the case where the kind-0 fetch hasn't
 * resolved (or failed) but we still know the pubkey from the decoded
 * npub/nprofile. ContactProfileScreen lazily fetches the bio + Lightning
 * address from its own relays, so this is enough to navigate immediately;
 * the screen fills the rest in. `about: undefined` (not null) leaves the
 * screen's fetch trigger armed.
 */
export function pubkeyToContactBodyStub(pubkey: string): ContactProfileBodyData {
  const npub = npubEncode(pubkey);
  return {
    pubkey,
    name: `${npub.slice(0, 12)}…`,
    picture: null,
    source: 'nostr',
    lightningAddress: null,
  };
}
