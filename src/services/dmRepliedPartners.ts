import { REPLY_WIRE_KINDS, selectRepliedConversations, subscribeDmStorage } from './dmDb';

// "You replied to them" as a follow-gate pass (#1623). Opening a thread with
// someone you don't follow shows their messages (the thread fetch bypasses
// the gate), and you can reply. Once you have, the rest of that conversation
// must arrive like any other: before this, the live gate dropped their later
// messages and reactions while the thread was on screen.
//
// Only the receive gates use this. The Messages list keeps its own trust
// tiers, so a parent-managed account still sees only followed people there.

const repliedByOwner = new Map<string, Set<string>>();
const loads = new Map<string, Promise<void>>();
// Bumped by `forgetRepliedPartners`, so a read that started before an
// account wipe can't put its result back afterwards.
const epochs = new Map<string, number>();
// Bumped each time we reply to someone new: their earlier wraps may sit in
// the inbox skip-set from when they didn't pass the gate (#1623).
const generations = new Map<string, number>();
let unsubscribe: (() => void) | null = null;

// Keep the sets current as we send. Rows written before an owner's first load
// are covered by that load's query.
function watchSends(): void {
  if (unsubscribe) return;
  unsubscribe = subscribeDmStorage((owner, rows) => {
    for (const row of rows) {
      if (!row.fromMe || !REPLY_WIRE_KINDS.includes(row.wireKind)) continue;
      const set = repliedByOwner.get(owner) ?? new Set<string>();
      const partner = row.conversation.toLowerCase();
      if (set.has(partner)) continue;
      set.add(partner);
      repliedByOwner.set(owner, set);
      generations.set(owner, (generations.get(owner) ?? 0) + 1);
    }
  });
}

/** Read who `owner` has replied to from the store. Once per owner; a failed
 * read is retried by the next call. Never rejects. */
export function loadRepliedPartners(owner: string): Promise<void> {
  watchSends();
  const pending = loads.get(owner);
  if (pending) return pending;
  const epoch = epochs.get(owner) ?? 0;
  const load = selectRepliedConversations(owner)
    .then((partners) => {
      if ((epochs.get(owner) ?? 0) !== epoch) return;
      const set = repliedByOwner.get(owner) ?? new Set<string>();
      for (const p of partners) set.add(p.toLowerCase());
      repliedByOwner.set(owner, set);
    })
    .catch(() => {
      if (loads.get(owner) === load) loads.delete(owner);
    });
  loads.set(owner, load);
  return load;
}

/** Whether `owner` has sent `partner` a 1:1 message. False until loaded. */
export function hasRepliedTo(owner: string, partner: string): boolean {
  return repliedByOwner.get(owner)?.has(partner.toLowerCase()) ?? false;
}

/** Forget an account's replies (its DM store was wiped). */
export function forgetRepliedPartners(owner: string): void {
  repliedByOwner.delete(owner);
  loads.delete(owner);
  epochs.set(owner, (epochs.get(owner) ?? 0) + 1);
}

/** Changes whenever `owner` replies to someone new (see `generations`). */
export function repliedPartnersGeneration(owner: string): number {
  return generations.get(owner) ?? 0;
}

export function __resetRepliedPartnersForTests(): void {
  repliedByOwner.clear();
  loads.clear();
  epochs.clear();
  generations.clear();
  unsubscribe?.();
  unsubscribe = null;
}
