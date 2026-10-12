// Per-group activity rollup for the Messages list (last message preview,
// recent posters, newest @mention of the viewer), derived from a group's stored
// message log. Pure — GroupsContext calls it on load and on every inbound
// group message. Extracted from GroupsContext (#1295, file-size cap).
import type { Group, GroupActivity } from '../types/groups';
import { dmRowPreview } from './dmRowPreview';
import { messageMentions } from './chatMentions';
import { latestMentionAt } from './chatUnread';

/** The stored-message fields the rollup reads. */
export interface ActivityMessage {
  id?: string;
  senderPubkey: string;
  text: string;
  createdAt: number;
  mentions?: string[];
}

const RECENT_SENDERS_CAP = 3;

export function computeRecentSenders(
  messages: readonly { senderPubkey: string; createdAt: number }[],
): string[] {
  // Walk newest-first, dedup by pubkey, take up to N. Storage already
  // sorts by createdAt asc, so iterate from the tail.
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = messages.length - 1; i >= 0 && out.length < RECENT_SENDERS_CAP; i--) {
    const pk = messages[i].senderPubkey.toLowerCase();
    if (seen.has(pk)) continue;
    seen.add(pk);
    out.push(pk);
  }
  return out;
}

export function activityFromMessages(
  group: Group,
  messages: readonly ActivityMessage[],
  viewer: string | null,
): GroupActivity {
  const groupCreatedAtSec = Math.floor(group.createdAt / 1000);
  if (messages.length === 0) {
    return {
      lastActivityAt: groupCreatedAtSec,
      lastText: '',
      lastSenderPubkey: null,
      recentSenderPubkeys: [],
    };
  }
  const last = messages[messages.length - 1];
  // Math.max guards against the (rare) case where a relay returns a
  // message with `createdAt` earlier than the local group's
  // `createdAt` — clock skew or an event back-dated via NIP-59 wrap
  // randomisation. Honours the docstring invariant in
  // `types/groups.ts:GroupActivity.lastActivityAt`.
  return {
    lastActivityAt: Math.max(last.createdAt, groupCreatedAtSec),
    // An encrypted file's stored text (`#lpe=1…`, NIP-17 or Marmot) embeds its
    // decryption key — redact it to the attachment label like DM previews.
    lastText: dmRowPreview(last.text, last.text.includes('#lpe=1') ? 15 : 14),
    lastMessageId: last.id,
    lastSenderPubkey: last.senderPubkey.toLowerCase(),
    recentSenderPubkeys: computeRecentSenders(messages),
    ...mentionRollup(messages, viewer),
  };
}

/** `lastMentionAt` for the Messages-list `@` badge (#1295), when there is one. */
function mentionRollup(
  messages: readonly ActivityMessage[],
  viewer: string | null,
): Pick<GroupActivity, 'lastMentionAt'> {
  const at = latestMentionAt(messages, viewer, (m) => messageMentions(m, viewer));
  return at === undefined ? {} : { lastMentionAt: at };
}
