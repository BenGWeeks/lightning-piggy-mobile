import type { NotificationHistoryEntry } from '../services/notificationHistory';
import { fallbackName } from './conversationSummaries';

/**
 * Titles the app fires when it can't (or, for privacy, doesn't) name the
 * sender. A history row showing one of these says nothing about who wrote —
 * so the Notifications screen names the row itself wherever it can.
 */
export const GENERIC_MESSAGE_TITLES: ReadonlySet<string> = new Set([
  'New message',
  'New messages',
  'New encrypted message',
  'New group message',
]);

export interface DisplayIdentity {
  name?: string | null;
  picture?: string | null;
}

export interface NotificationDisplay {
  title: string;
  picture: string | null;
}

/**
 * Pure: what a Notifications row shows — the same name and avatar the
 * Messages list uses for that thread, so the two screens agree:
 *  - a 1:1 row: the partner's profile (contact or non-followed), else a real
 *    name the alert carried, else the npub the Messages list also falls back
 *    to — never a bare "New message";
 *  - a group row: the group's current name, else the title it was fired with;
 *  - anything else (payments, finds, generic pings): its own title.
 * `partner` is the row's conversation, or the one its wrap resolved to.
 */
export function notificationDisplay(
  entry: Pick<NotificationHistoryEntry, 'kind' | 'title' | 'data'>,
  opts: {
    partner?: string;
    profileFor: (pubkey: string) => DisplayIdentity | undefined;
    groupFor: (groupId: string) => DisplayIdentity | undefined;
  },
): NotificationDisplay {
  const named = !GENERIC_MESSAGE_TITLES.has(entry.title);
  if (entry.kind === 'group' && entry.data.groupId) {
    const group = opts.groupFor(entry.data.groupId);
    return {
      title: group?.name?.trim() || entry.title,
      picture: group?.picture ?? null,
    };
  }
  const partner = opts.partner?.toLowerCase();
  if ((entry.kind === 'dm' || entry.kind === 'zap') && partner) {
    const profile = opts.profileFor(partner);
    return {
      title: profile?.name?.trim() || (named ? entry.title : fallbackName(partner)),
      picture: profile?.picture ?? null,
    };
  }
  return { title: entry.title, picture: null };
}
