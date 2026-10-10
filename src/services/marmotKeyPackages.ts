// Which of a peer's published Marmot key packages (kind 30443) we can
// invite — and the errors for when none will do. Pure.

import { getKeyPackageLifetime } from '@internet-privacy/marmot-ts';
import { verifyEvent, type Event as NostrEvent } from 'nostr-tools';

// Mirrors marmot-ts's invite-time KeyPackage checks (createInviteIntent): a
// valid signature, the singleton d / i / mls_protocol_version=1.0 tags, and a
// LeafNode lifetime within the 7,261,200 s cap and current (±1 h grace).
const KEY_PACKAGE_LIFETIME_CAP_SECS = 7_261_200;
const KEY_PACKAGE_LIFETIME_GRACE_SECS = 3_600;
export function isUsableKeyPackage(
  e: NostrEvent,
  nowSecs = Math.floor(Date.now() / 1000),
): boolean {
  const single = (name: string) => {
    const tags = e.tags.filter((t) => t[0] === name);
    return tags.length === 1 ? tags[0][1] : undefined;
  };
  if (!single('d') || !single('i') || single('mls_protocol_version') !== '1.0') return false;
  if (!verifyEvent(e)) return false;
  const lifetime = getKeyPackageLifetime(e);
  if (!lifetime) return false;
  const notBefore = Number(lifetime.notBefore);
  const notAfter = Number(lifetime.notAfter);
  return (
    notAfter - notBefore <= KEY_PACKAGE_LIFETIME_CAP_SECS &&
    nowSecs >= notBefore - KEY_PACKAGE_LIFETIME_GRACE_SECS &&
    nowSecs <= notAfter + KEY_PACKAGE_LIFETIME_GRACE_SECS
  );
}

/** The peer published key packages, but none Marmot can accept: expired,
 * over-long lifetime, or an older Marmot format the v2 library can't decode
 * (e.g. MDK 0.8.x / older White Noise) — the peer needs a current client. */
export class MarmotUnusableKeyPackageError extends Error {
  constructor(readonly pubkey: string) {
    super(`No usable Marmot key package for ${pubkey.slice(0, 8)}`);
    this.name = 'MarmotUnusableKeyPackageError';
  }
}

export class MarmotNoKeyPackageError extends Error {
  constructor(readonly pubkey: string) {
    super(`No Marmot key package published for ${pubkey.slice(0, 8)}`);
    this.name = 'MarmotNoKeyPackageError';
  }
}

/**
 * The key package to invite `peer` with: newest per publication slot (`d`),
 * then newest first; the first the library will accept — a peer's client may
 * have published an expired / over-long one alongside a good one (or only
 * bad ones). Null when they published none; throws when none is usable.
 */
export function pickKeyPackage(peer: string, events: NostrEvent[]): NostrEvent | null {
  const newestPerSlot = new Map<string, NostrEvent>();
  for (const e of events) {
    const slot = e.tags.find((t) => t[0] === 'd')?.[1] ?? e.id;
    const prev = newestPerSlot.get(slot);
    if (!prev || e.created_at > prev.created_at) newestPerSlot.set(slot, e);
  }
  const candidates = [...newestPerSlot.values()].sort(
    (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
  );
  const usable = candidates.find((e) => isUsableKeyPackage(e));
  if (usable) return usable;
  if (candidates.length > 0) throw new MarmotUnusableKeyPackageError(peer);
  return null;
}
