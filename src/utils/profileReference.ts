import * as nip19 from 'nostr-tools/nip19';
import { isSafeRelayHint } from './remoteUrlPolicy';

export interface DecodedProfileReference {
  pubkey: string;
  relays: string[];
}

// Accepts a NIP-21 `nostr:` URI or a bare bech32 identifier and returns
// the pubkey + optional relay hints when it's a profile reference
// (npub or nprofile). Returns null for anything else (note, nevent, …).
// NIP-21 URI schemes are case-insensitive — `NOSTR:`, `Nostr:`, etc.
// all need to be accepted, so strip with a case-insensitive match.
export function decodeProfileReference(input: string): DecodedProfileReference | null {
  const stripped = /^nostr:/i.test(input) ? input.slice(6) : input;
  try {
    const decoded = nip19.decode(stripped);
    if (decoded.type === 'npub') {
      return { pubkey: decoded.data, relays: [] };
    }
    if (decoded.type === 'nprofile') {
      return {
        pubkey: decoded.data.pubkey,
        relays: (decoded.data.relays ?? []).filter(isSafeRelayHint).slice(0, 3),
      };
    }
  } catch {
    // fall through
  }
  return null;
}
