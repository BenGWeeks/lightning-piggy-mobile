export interface Group {
  id: string;
  name: string;
  memberPubkeys: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Per-group activity rollup derived from the group's stored message log.
 * Drives the unified Messages-tab list: timestamp + preview + the stacked
 * avatars that show the most-recent posters in the thread.
 *
 * `lastActivityAt` falls back to the group's createdAt when no messages
 * have been exchanged yet, so a freshly-created empty group still appears
 * in the inbox at its creation time rather than at unix-epoch 0.
 */
export interface GroupActivity {
  /** Unix seconds — newer of (last message createdAt, group.createdAt/1000). */
  lastActivityAt: number;
  /** Empty string if no messages yet. */
  lastText: string;
  /** Lowercased hex; null when no messages yet. */
  lastSenderPubkey: string | null;
  /**
   * Up to 3 lowercased hex pubkeys of the most-recent distinct posters,
   * newest-first. Empty when no messages yet — the row falls back to
   * member-derived avatars in that case.
   */
  recentSenderPubkeys: string[];
}

/** Combined Group + GroupActivity, shaped for the Messages-tab list. */
export interface GroupSummary {
  group: Group;
  activity: GroupActivity;
}
