// Session-only record of chat media the reader tapped to load (#1338), so a
// FlatList row that unmounts and remounts doesn't ask again. Keyed by ACCOUNT
// then media identity: one account's consent never applies to another on a
// shared phone, and sign-out forgets it. Never persisted — a fresh session
// re-gates everything.

const byOwner = new Map<string, Set<string>>();

const ownerKey = (owner: string | null): string => owner ?? '';

export function isMediaRevealed(owner: string | null, key: string): boolean {
  return byOwner.get(ownerKey(owner))?.has(key) ?? false;
}

export function markMediaRevealed(owner: string | null, key: string): void {
  const k = ownerKey(owner);
  let set = byOwner.get(k);
  if (!set) {
    set = new Set();
    byOwner.set(k, set);
  }
  set.add(key);
}

/** Sign-out wipe: drop everything this account tapped to load. */
export function forgetRevealedMedia(owner: string): void {
  byOwner.delete(owner);
}

/** Test-only. */
export function __resetForTests(): void {
  byOwner.clear();
}
