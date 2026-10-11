// Which of "Edit" / "Delete for everyone" a message offers (#1237). Pure, so
// both chat screens share one rule:
//  - Marmot chats only: NIP-04 / NIP-17 have no edit or delete that other
//    apps honour, so the actions would silently do nothing for the peer.
//  - Your own messages only (admin-deleting others' is a follow-up).
//  - Only once the message is sent and has its real Marmot id: a row still
//    sending (or failed) has nothing peers could match.
//  - Edit only for plain text (White Noise edits kind-9 text); photos, voice
//    notes, polls, locations and GIFs can be deleted but not edited.

export interface MessageEditDeleteInput {
  isMarmot: boolean;
  fromMe: boolean;
  /** The message's Marmot event id (1:1: its rumor id). */
  targetId?: string;
  /** Plain chat text (incl. links / invoices) — not media or a structured payload. */
  isPlainText: boolean;
  /** Still sending, or the send failed — peers may never have received it. */
  pending?: boolean;
}

export interface MessageEditDelete {
  canEdit: boolean;
  canDelete: boolean;
}

const HEX64 = /^[0-9a-f]{64}$/i;

export function messageEditDelete(input: MessageEditDeleteInput): MessageEditDelete {
  const canDelete =
    input.isMarmot &&
    input.fromMe &&
    !input.pending &&
    !!input.targetId &&
    HEX64.test(input.targetId);
  return { canDelete, canEdit: canDelete && input.isPlainText };
}
