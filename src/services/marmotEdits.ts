// Inbound edits and quoted replies in Marmot chats, the way White Noise sends
// them (MDK `AppMessageIntent::Edit` / `Reply`):
//
//  - Edit: a kind-1009 app event, one `e` tag naming the original message,
//    `content` = the replacement text. Honoured only from the original's
//    author; competing edits order by the edit's own `created_at`, latest
//    wins, ties going to the higher edit event id (as MDK orders them —
//    `ORDER BY recorded_at DESC, message_id_hex DESC`). Edits are not chat rows.
//  - Reply: an ordinary kind-9 chat carrying `["e", parent]` and
//    `["q", parent]` (both the parent's id).
//
// Pure parsing + a small ledger, free of React and I/O. The ledger holds
// edits whose target hasn't been stored yet (an edit can overtake its
// message; the history also replays on every start) so the text still
// overlays when the target arrives.

import { isNewerEdit } from '../utils/marmotEditOrder';
import { MARMOT_CHAT_KIND, type MarmotRumor } from './marmotSession';

export { isNewerEdit };

export const MARMOT_EDIT_KIND = 1009;

const HEX64 = /^[0-9a-f]{64}$/;
const LEDGER_CAP = 500;

export interface MarmotEdit {
  /** Lowercase id of the message being edited. */
  target: string;
  /** Replacement text. */
  content: string;
  /** Lowercase pubkey of whoever sent the edit. */
  editor: string;
  /** The edit event's `created_at` — orders competing edits. */
  editedAt: number;
  /** The edit event's own id (lowercase) — breaks `editedAt` ties. */
  editId: string;
}

/** The edit a rumor carries, or null when it isn't a usable one. */
export function parseMarmotEdit(rumor: MarmotRumor): MarmotEdit | null {
  if (rumor.kind !== MARMOT_EDIT_KIND) return null;
  const target = rumor.tags.find((t) => t[0] === 'e' && typeof t[1] === 'string')?.[1];
  const id = target?.toLowerCase();
  if (!id || !HEX64.test(id) || rumor.content.trim() === '') return null;
  return {
    target: id,
    content: rumor.content,
    editor: rumor.pubkey.toLowerCase(),
    editedAt: rumor.created_at,
    editId: rumor.id.toLowerCase(),
  };
}

/**
 * The message a kind-9 chat replies to (`q` tag, else the `e` tag), lowercase,
 * or undefined. Only chat messages reply; other kinds ignore these tags.
 */
export function marmotReplyParent(rumor: MarmotRumor): string | undefined {
  if (rumor.kind !== MARMOT_CHAT_KIND) return undefined;
  const tag = (name: string) =>
    rumor.tags.find(
      (t) => t[0] === name && typeof t[1] === 'string' && HEX64.test(t[1].toLowerCase()),
    );
  const parent = (tag('q') ?? tag('e'))?.[1];
  return parent?.toLowerCase();
}

/** Remembers the latest edit per (message, editor) so one arriving before (or
 * replayed after) its target still applies. Keyed by editor too, so a forged
 * edit from someone else can never displace the author's own. Scoped by group
 * like deletions. */
export class EditLedger {
  private readonly latest = new Map<string, MarmotEdit>();

  private key = (groupId: string, target: string, editor: string) =>
    `${groupId}:${target.toLowerCase()}:${editor.toLowerCase()}`;

  add(edit: MarmotEdit, groupId: string): void {
    const key = this.key(groupId, edit.target, edit.editor);
    const prior = this.latest.get(key);
    if (prior && !isNewerEdit(edit, prior)) return;
    this.latest.delete(key); // re-insert → newest in eviction order
    this.latest.set(key, edit);
    while (this.latest.size > LEDGER_CAP) {
      this.latest.delete(this.latest.keys().next().value as string);
    }
  }

  /** The newest edit to `messageId` made by its author `sender`, if any. */
  latestFor(messageId: string, sender: string, groupId: string): MarmotEdit | undefined {
    return this.latest.get(this.key(groupId, messageId, sender));
  }
}
