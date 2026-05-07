import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/**
 * Deterministic synthetic groupId for a NIP-17 spec-defined chat room.
 *
 * Per NIP-17:
 *
 *   "The set of pubkey + p tags defines a chat room. If the set changes,
 *    a new room is created."
 *
 * Foreign clients (Amethyst / Quartz, 0xchat) follow this exactly: there
 * is no on-relay "group state" event, only the implicit room defined by
 * the participant set on each kind-14. Lightning Piggy uses a custom
 * kind-30200 event for its native groups (with a UUID-shaped `g_…` id),
 * so when we receive a foreign-client kind-14 with no matching kind-30200
 * we materialise a SYNTHETIC group whose id is derived from the
 * participant set itself, so:
 *
 *  - the id is stable across sessions (no clock / RNG dependence)
 *  - all clients computing the same set get the same id
 *  - subsequent kind-14s from the same room route to the same local thread
 *
 * Algorithm: SHA-256 over the lowercased participant pubkeys joined with
 * a single `\n` after sorting, hex-encoded, prefixed with `s_` to
 * distinguish synthetic groups from native (`g_…`) ones in logs/storage.
 *
 * Inputs MUST include every pubkey in the room — the sender AND every
 * p-tag — exactly as the spec defines the "room". Callers should NOT
 * exclude the viewer when computing the id (that would yield a
 * different id on the viewer's device than on every peer's device).
 */
export function syntheticGroupIdForParticipants(participants: Iterable<string>): string {
  const sorted = Array.from(new Set(Array.from(participants).map((p) => p.toLowerCase()))).sort();
  const digest = sha256(new TextEncoder().encode(sorted.join('\n')));
  return `s_${bytesToHex(digest)}`;
}

/**
 * True when a groupId was minted by `syntheticGroupIdForParticipants`.
 * Used to gate behaviour that should differ between native LP groups
 * (mutable rosters, kind-30200-backed) and synthetic NIP-17 rooms
 * (immutable per spec — roster change = new room).
 */
export function isSyntheticGroupId(groupId: string): boolean {
  return groupId.startsWith('s_');
}
