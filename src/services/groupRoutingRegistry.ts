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
 * Reconcile a synthetic NIP-17 room (kind-14 from a foreign client with
 * no matching kind-30200) into local state. GroupsContext registers a
 * handler at mount time; NostrContext invokes it from the route-rumor
 * fallback path when the registry's exact-match lookup misses but the
 * rumor carries a `subject` tag.
 *
 * Returns the resolved Group (existing or freshly-created) on success,
 * null when no handler is registered (typically only during cold
 * boot / logout) so callers can no-op cleanly.
 *
 * Implementation MUST be idempotent on (groupId, name): subsequent
 * kind-14s from the same room invoke this with the same id and the
 * latest subject — a no-op when nothing changed, a name update when
 * the subject was edited (NIP-17: "the newest subject in the chat
 * room is the subject of the conversation").
 */
export interface SyntheticRoomInput {
  groupId: string;
  name: string;
  /** All participants OTHER than the viewer (matches Group.memberPubkeys). */
  memberPubkeys: string[];
  /** seconds — the kind-14's created_at, for newest-wins subject resolution. */
  createdAtSec: number;
}

type SyntheticReconciler = (input: SyntheticRoomInput) => Promise<Group | null>;
let syntheticReconciler: SyntheticReconciler | null = null;

export function setSyntheticGroupReconciler(fn: SyntheticReconciler | null): void {
  syntheticReconciler = fn;
}

export async function reconcileSyntheticGroup(input: SyntheticRoomInput): Promise<Group | null> {
  if (!syntheticReconciler) return null;
  return syntheticReconciler(input);
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
