import { decode } from 'nostr-tools/nip19';
import { normalizePubkey } from './pubkey';

/** Canonical hex at both sides of the live gate, including legacy npub cache values. */
export function followPubkey(value: string): string | null {
  const hex = normalizePubkey(value);
  if (hex) return hex;
  try {
    const decoded = decode(value);
    return decoded.type === 'npub' ? normalizePubkey(decoded.data) : null;
  } catch {
    return null;
  }
}

export function buildFollowSet(pubkeys: Iterable<string>): Set<string> {
  const result = new Set<string>();
  for (const value of pubkeys) {
    const hex = followPubkey(value);
    if (hex) result.add(hex);
  }
  return result;
}

export function isFollowed(follows: Set<string>, partner: string): boolean {
  const hex = followPubkey(partner);
  return hex !== null && follows.has(hex);
}
