// Which Marmot application kinds are chat messages — dependency-free, so the
// push-wake module (loaded at every JS start, headless included) can tell
// without pulling in the MLS stack.

/**
 * Marmot application events that aren't chat messages: protocol plumbing and
 * actions on other messages that White Noise / Amethyst send into every
 * group — MIP-05 push tokens (447–449, JSON payloads), deletes (5),
 * reactions (7), edits (1009), moderation (1984, 1985, 4891), agent streams
 * (1200–1202), group-system notices (1210) and our live-location updates
 * (20069, #1300). Never stored as rows, so they can't surface as
 * "unsupported" bubbles or raw-JSON previews.
 */
export const MARMOT_NON_MESSAGE_KINDS: readonly number[] = [
  5, 7, 447, 448, 449, 1009, 1200, 1201, 1202, 1210, 1984, 1985, 4891, 20069,
];

/** Live state, not conversation (#1300): NIP-01's ephemeral range — today the
 *  live-location coordinate update (kind 20069). See marmotTransientRumors. */
export const isTransientMarmotKind = (kind: number): boolean => kind >= 20000 && kind < 30000;

/** Not a chat row: a listed plumbing kind, or any transient (ephemeral-range) event. */
export const isMarmotMessageKind = (kind: number) =>
  !MARMOT_NON_MESSAGE_KINDS.includes(kind) && !isTransientMarmotKind(kind);
