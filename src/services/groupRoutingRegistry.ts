import type { Group } from '../types/groups';

/**
 * Module-level registry of locally-known groups, keyed by groupId.
 * GroupsContext keeps this in sync via `setKnownGroups` whenever its
 * groups state changes. NostrContext consults `findGroupForParticipants`
 * inside its NIP-17 decrypt loop to route inbound kind-14 rumors with
 * 2+ participants to the right local group.
 *
 * The registry is RAM-only — it's a mirror of GroupsContext.groups, not
 * a persistence layer. AsyncStorage is the source of truth.
 *
 * Rationale for module state vs. context: GroupsContext is mounted INSIDE
 * NostrProvider, so NostrContext can't `useGroups()` directly. We could
 * pass groups via a ref-callback pattern, but a tiny module is simpler
 * and lets the Nostr decrypt loop stay synchronous (no React re-renders
 * to worry about for the lookup).
 */

let known: Group[] = [];

export function setKnownGroups(groups: Group[]): void {
  known = groups;
}

export function getKnownGroups(): readonly Group[] {
  return known;
}

/**
 * Find a group whose membership matches the given participant set.
 *
 * `otherParticipants` is the rumor's full participant set with the
 * viewer EXCLUDED (see `classifyRumor`). A group matches when its
 * `memberPubkeys` (which by convention exclude the viewer too) form
 * an exact set-equality with `otherParticipants`.
 *
 * If no group matches, returns null. Callers should NOT auto-create
 * groups from inbound messages — that path is restricted to the
 * kind-30200 reconciliation in GroupsContext, which has the friend-graph
 * trust check.
 */
export function findGroupForParticipants(otherParticipants: Set<string>): Group | null {
  for (const group of known) {
    if (group.memberPubkeys.length !== otherParticipants.size) continue;
    let mismatch = false;
    for (const pk of group.memberPubkeys) {
      if (!otherParticipants.has(pk.toLowerCase())) {
        mismatch = true;
        break;
      }
    }
    if (!mismatch) return group;
  }
  return null;
}
