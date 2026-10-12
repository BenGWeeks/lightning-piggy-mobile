import { useMemo, useRef } from 'react';
import { useReadPositions } from './useReadPositions';
import { groupReadKey } from '../services/chatReadPositions';
import { hasUnreadMention } from '../utils/chatUnread';
import type { GroupSummary } from '../types/groups';

const EMPTY: ReadonlySet<string> = new Set();

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((id) => b.has(id));

/**
 * Groups with an unread message that mentions the viewer (#1295) — the
 * Messages list's `@` badges. Compares each group's `lastMentionAt` rollup
 * with its read position; keeps the same Set identity while the answer is
 * unchanged so the list's renderItem (and memoised rows) don't churn.
 */
export function useMentionedGroupIds(
  summaries: readonly GroupSummary[],
  owner: string | null | undefined,
): ReadonlySet<string> {
  const getMarker = useReadPositions(owner);
  const previous = useRef<ReadonlySet<string>>(EMPTY);
  return useMemo(() => {
    const next = new Set<string>();
    for (const s of summaries) {
      if (s.activity.lastMentionAt === undefined) continue;
      if (hasUnreadMention(s.activity.lastMentionAt, getMarker(groupReadKey(s.group.id)))) {
        next.add(s.group.id);
      }
    }
    if (sameSet(previous.current, next)) return previous.current;
    previous.current = next.size === 0 ? EMPTY : next;
    return previous.current;
  }, [summaries, getMarker]);
}
