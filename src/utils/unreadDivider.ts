import { firstUnreadId, type ReadMarker, type UnreadEntry } from './chatUnread';

/** Timeline rows may include local notices and date headers without messages. */
export interface UnreadTimelineItem {
  id: string;
  kind?: string;
  createdAt?: number;
  fromMe?: boolean;
  mentionsMe?: boolean;
}

/** Real messages in reading order, regardless of the list's data direction. */
export function chatUnreadEntries(
  items: readonly UnreadTimelineItem[],
  inverted: boolean,
): UnreadEntry[] {
  const entries: UnreadEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[inverted ? items.length - 1 - i : i];
    if (
      item.kind === 'dayHeader' ||
      item.kind === 'deviceNotice' ||
      item.kind === 'marmotInviteFailed' ||
      item.createdAt === undefined ||
      item.fromMe === undefined
    )
      continue;
    entries.push({
      id: item.id,
      createdAt: item.createdAt,
      fromMe: item.fromMe,
      mentionsMe: item.mentionsMe,
    });
  }
  return entries;
}

/**
 * Message immediately below the divider visually. Inverted data is newest-first;
 * render the divider and this message together in a normal-column wrapper.
 * An optional opening boundary stays fixed while reading, but is hidden when
 * there are no unread messages after it or its message no longer exists.
 */
export function unreadDividerId(
  items: readonly UnreadTimelineItem[],
  lastRead: ReadMarker | null,
  inverted: boolean,
  openingId?: string | null,
): string | null {
  const entries = chatUnreadEntries(items, inverted);
  const first = firstUnreadId(entries, lastRead);
  if (!first || openingId === null) return null;
  if (openingId === undefined) return first;
  const boundary = entries.findIndex((entry) => entry.id === openingId && !entry.fromMe);
  const unread = entries.findIndex((entry) => entry.id === first);
  return boundary >= 0 && boundary <= unread ? openingId : null;
}
