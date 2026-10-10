// Inbound "delete for everyone" in Marmot chats, the way White Noise sends it:
// a kind-5 app event inside the group whose `e` tag(s) name the message(s) to
// delete (marmot-app `AppMessageIntent::Delete`: empty content, one `e` tag).
// Groups also carry the admin form, kind 4891 (MIP content-moderation), whose
// content is exactly `{"v":1,"action":"remove"}`.
//
// Pure parsing + a small ledger of what has been deleted, kept free of React
// and I/O so it is unit-testable. The ledger is what makes deletion safe in
// the face of ordering: the app re-delivers the group's history on every
// start (and relays can reorder), so the delete may arrive BEFORE the
// message it targets — or the message may be replayed after it was removed.
// Either way the message must never (re)appear.
//
// Kind 5 is also how White Noise retracts a reaction (`e` → the reaction's
// id). Those targets simply never match a stored message, so they are inert.

import type { MarmotRumor } from './marmotSession';

export const MARMOT_DELETE_KIND = 5;
export const MARMOT_ADMIN_REMOVE_KIND = 4891;

const HEX64 = /^[0-9a-f]{64}$/;
/** Deletions the session ledger remembers before evicting the oldest. Not a
 * correctness bound: durable tombstones (marmotDeletionStore) back it. */
const LEDGER_CAP = 2000;

export interface MarmotDeletion {
  /** Lowercase message ids the event asks to delete. */
  targets: string[];
  /** Lowercase pubkey of whoever sent the deletion. */
  deleter: string;
  /** Admin removal: honoured whoever authored the target. Otherwise the
   * deleter must be the target's original sender. */
  anyAuthor: boolean;
}

const eTargets = (tags: string[][]): string[] =>
  tags
    .filter((t) => t[0] === 'e' && typeof t[1] === 'string')
    .map((t) => t[1].toLowerCase())
    .filter((id) => HEX64.test(id));

/** How many keys the top-level JSON object `json` spells out, duplicates
 * included (JSON.parse silently keeps the last of a duplicated key). Only
 * called on text JSON.parse already accepted, so tokens are well-formed. */
function topLevelKeyCount(json: string): number {
  let depth = 0;
  let count = 0;
  let expectKey = false;
  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (c === '"') {
      let j = i + 1;
      while (j < json.length && json[j] !== '"') j += json[j] === '\\' ? 2 : 1;
      if (depth === 1 && expectKey) count++;
      expectKey = false;
      i = j;
    } else if (c === '{' || c === '[') {
      depth++;
      expectKey = c === '{' && depth === 1;
    } else if (c === '}' || c === ']') {
      depth--;
    } else if (c === ',' && depth === 1) {
      expectKey = true;
    }
  }
  return count;
}

/** Spec (features/content-moderation.md): content is a JSON object with
 * exactly `v` = 1 and `action` = "remove"; duplicate keys are invalid. */
const isRemoveAction = (content: string): boolean => {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const record = parsed as Record<string, unknown>;
    return (
      Object.keys(record).length === 2 &&
      record.v === 1 &&
      record.action === 'remove' &&
      topLevelKeyCount(content) === 2
    );
  } catch {
    return false;
  }
};

/**
 * The deletion a rumor asks for, or null when it isn't one (or has no effect).
 * White Noise's "Delete for everyone" is kind 5 from an ordinary member — the
 * author retracting their own message — but kind 4891 from an admin (every
 * member of a 1:1 chat is one — the "An admin deleted this message" it shows).
 *
 * Kind 4891 is parsed strictly, as the spec requires: exactly one `e` tag
 * holding a 64-char lowercase hex id, the exact content above, and a sender
 * who is a group admin. A malformed or non-admin 4891 has NO effect (spec;
 * MDK timeline.rs honours 4891 only with moderation authority).
 * Known limitation: admin status is the group's current admin list, not the
 * sender's authority in the event's source epoch.
 */
export function parseMarmotDeletion(
  rumor: MarmotRumor,
  group: { isDm: boolean; adminPubkeys: readonly string[] },
): MarmotDeletion | null {
  const deleter = rumor.pubkey.toLowerCase();
  if (rumor.kind === MARMOT_DELETE_KIND) {
    const targets = eTargets(rumor.tags);
    return targets.length > 0 ? { targets, deleter, anyAuthor: false } : null;
  }
  if (rumor.kind === MARMOT_ADMIN_REMOVE_KIND) {
    if (!group.adminPubkeys.some((a) => a.toLowerCase() === deleter)) return null;
    const eTags = rumor.tags.filter((t) => t[0] === 'e');
    if (eTags.length !== 1) return null;
    const target = eTags[0][1];
    if (typeof target !== 'string' || !HEX64.test(target)) return null;
    if (!isRemoveAction(rumor.content)) return null;
    return { targets: [target], deleter, anyAuthor: true };
  }
  return null;
}

/** Whether `deleter` may delete a message that `sender` authored. */
export const mayDelete = (d: MarmotDeletion, sender: string): boolean =>
  d.anyAuthor || d.deleter === sender.toLowerCase();

/** Remembers deletions so a target arriving (or replaying) later is dropped.
 * Scoped by group: an event id is only deletable by a deletion sent into the
 * group the message lives in (an admin of one group has no say in another). */
export class DeletionLedger {
  private readonly byTarget = new Map<string, { deleters: Set<string>; anyAuthor: boolean }>();

  constructor(private readonly cap = LEDGER_CAP) {}

  add(deletion: MarmotDeletion, groupId: string): void {
    for (const id of deletion.targets) {
      const target = `${groupId}:${id}`;
      const entry = this.byTarget.get(target) ?? { deleters: new Set<string>(), anyAuthor: false };
      entry.deleters.add(deletion.deleter);
      entry.anyAuthor ||= deletion.anyAuthor;
      this.byTarget.delete(target); // re-insert → newest in eviction order
      this.byTarget.set(target, entry);
    }
    while (this.byTarget.size > this.cap) {
      this.byTarget.delete(this.byTarget.keys().next().value as string);
    }
  }

  /** True when `messageId`, authored by `sender`, has been validly deleted. */
  blocks(messageId: string, sender: string, groupId: string): boolean {
    const entry = this.byTarget.get(`${groupId}:${messageId.toLowerCase()}`);
    return !!entry && (entry.anyAuthor || entry.deleters.has(sender.toLowerCase()));
  }
}
