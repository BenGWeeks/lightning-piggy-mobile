// In-memory snapshot of the active account's failed Marmot invites (#1269),
// published by its MarmotSession and read by the Messages list + 1:1 thread
// through `useFailedMarmotInvites` (useSyncExternalStore). Tagged with the
// owning account so a previous account's list never paints under the next.

import type { FailedMarmotInvite } from './marmotWelcomeOutcomes';

export interface FailedInvitesSnapshot {
  owner: string | null;
  invites: readonly FailedMarmotInvite[];
}

const EMPTY: FailedInvitesSnapshot = { owner: null, invites: [] };
let snapshot: FailedInvitesSnapshot = EMPTY;
const listeners = new Set<() => void>();

const sameInvites = (a: readonly FailedMarmotInvite[], b: readonly FailedMarmotInvite[]) =>
  a.length === b.length && a.every((x, i) => x.id === b[i].id && x.reason === b[i].reason);

export function publishFailedMarmotInvites(
  owner: string,
  invites: readonly FailedMarmotInvite[],
): void {
  // Unchanged → keep the same snapshot object, so nothing re-renders.
  if (snapshot.owner === owner && sameInvites(snapshot.invites, invites)) return;
  snapshot = { owner, invites };
  for (const l of listeners) l();
}

/** Drop `owner`'s snapshot (their session stopped). */
export function clearFailedMarmotInvites(owner: string): void {
  if (snapshot.owner !== owner) return;
  snapshot = EMPTY;
  for (const l of listeners) l();
}

export function getFailedMarmotInvitesSnapshot(): FailedInvitesSnapshot {
  return snapshot;
}

export function subscribeFailedMarmotInvites(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
