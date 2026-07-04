import { getEventHash } from 'nostr-tools/pure';

/**
 * Structured NIP-88 polls, gift-wrapped inside NIP-17 DMs (#203).
 *
 * --- Why NIP-88 events, not the text-encoded MVP? ---
 * NIP-88 defines polls as PUBLIC events (kind 1068 poll + kind 1018 vote). We
 * want the SAME structured events but kept PRIVATE inside DMs, so instead of
 * publishing them to public relays we build them as NIP-17 *rumors* and
 * gift-wrap them to the conversation's participants:
 *
 *   - Poll: a kind-1068 rumor whose `option` / `polltype` / `endsAt` tags carry
 *     the poll shape; gift-wrapped to the recipient(s) via the existing NIP-17
 *     send path. Responses come back over gift-wrap, so the public `relay` tags
 *     NIP-88 normally carries are dropped.
 *   - Vote: a kind-1018 rumor whose `e` tag references the poll rumor's id and
 *     whose `response` tag(s) carry the chosen option id(s); gift-wrapped back
 *     to the participants (the author in a 1:1, every member in a group) so
 *     everyone can tally client-side.
 *
 * This is a FIRST-MOVER pattern — there is no NIP for "NIP-88 inside NIP-17"
 * yet — so only LP↔LP clients render + vote until other clients adopt it. A
 * foreign client sees an unrenderable inner kind (it can't decrypt anyway).
 *
 * --- Local storage bridge ---
 * LP's `dm_messages` store is a flat row: `content` (text) + `wireKind` (the
 * inner rumor kind), no tags column. So — exactly like the kind-16/17 order
 * cards (`orderEvents.ts`) — on ingest we serialize the poll/vote rumor into a
 * canonical JSON string kept in `content`, keyed by `wireKind` 1068 / 1018. The
 * renderer + tally rebuild from that JSON. The event on the WIRE stays a genuine
 * NIP-88 event; the JSON is purely how this app persists any DM.
 *
 * The poll's identity (what a vote's `e` tag references) is the poll RUMOR's
 * event id (`getEventHash` of the inner event) — deterministic and identical on
 * the sender's optimistic append and every recipient's decrypt, so votes
 * correlate without needing a persisted rumor-id column.
 */

export const POLL_KIND = 1068;
export const VOTE_KIND = 1018;

export type PollType = 'singlechoice' | 'multiplechoice';

// Hard caps on shape so a malformed poll can never blow up the renderer. Kept
// in lock-step with the text-encoded MVP (`pollMessage.ts`) so the composer's
// limits are identical whichever wire format a thread uses.
export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 6;
export const POLL_MAX_QUESTION_LENGTH = 200;
export const POLL_MAX_OPTION_LENGTH = 80;

/** A single poll option: a stable string id (NIP-88 option ids are strings) + its label. */
export interface PollOption {
  id: string;
  label: string;
}

/**
 * The render shape a PollBubble draws. Deliberately carries NO correlation id —
 * the poll's id (vote target / tally key) is threaded separately by the caller
 * (the structured rumor id for NIP-88 polls, the message id for legacy text
 * polls), so this stays a pure presentation record usable by both wire formats.
 */
export interface DisplayPoll {
  question: string;
  options: PollOption[];
  pollType: PollType;
  /** Unix seconds after which voting is closed; undefined = open indefinitely. */
  endsAt?: number;
}

/** A stored poll: its display shape plus the correlation id + author. */
export interface StoredPoll extends DisplayPoll {
  /** Poll rumor event id — what a vote's `e` tag references. */
  pollId: string;
  /** Hex pubkey of the poll's author. */
  author: string;
}

/** A single voter's selection on one poll, one record per vote rumor. */
export interface VoteRecord {
  /** The poll rumor id this vote references (`e` tag). */
  pollId: string;
  /** Hex pubkey of the voter. */
  voter: string;
  /** Chosen option ids (`response` tags). Multiple only for multiplechoice. */
  optionIds: string[];
  /** When the vote landed (epoch seconds). Drives last-write-wins per voter. */
  createdAt: number;
}

/** Per-poll tally, tuned for direct rendering (each option carries its count). */
export interface PollTally {
  pollId: string;
  question: string;
  options: { id: string; label: string; count: number }[];
  /** Distinct voters counted (one per pubkey, latest vote). */
  totalVoters: number;
  /** Option ids the viewer currently has selected (empty when they haven't voted). */
  myVotes: string[];
  /** True once `endsAt` has passed — the bubble disables further voting. */
  closed: boolean;
}

/** Minimal unsigned-rumor shape the builders/parsers need. */
export interface PollRumor {
  pubkey: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

const HEX64 = /^[0-9a-f]{64}$/;

const firstTagValue = (tags: string[][], name: string): string | undefined =>
  tags.find((t) => t[0] === name)?.[1];

/** Normalise an option id to the index-based `1..n` scheme this app emits. */
const optionIdForIndex = (index: number): string => String(index + 1);

/**
 * Build a kind-1068 poll rumor addressed (via `p` tags) to the given
 * recipients. Validates the same shape the composer enforces. Option ids are
 * generated `1..n` (stable across the poll's lifetime). The returned event is
 * unsigned — hand it to the NIP-17 gift-wrap send path.
 */
export function buildPollRumor(input: {
  senderPubkey: string;
  recipientPubkeys: string[];
  question: string;
  options: string[];
  pollType?: PollType;
  endsAt?: number;
  createdAt?: number;
}): PollRumor {
  const question = input.question.trim();
  if (!question) throw new Error('Poll question is required');
  if (question.length > POLL_MAX_QUESTION_LENGTH) {
    throw new Error(`Question too long (max ${POLL_MAX_QUESTION_LENGTH} chars)`);
  }
  // Reject embedded newlines. Structured tags tolerate them, but the composer
  // is shared with the group text-encoded path (where a stray newline injects
  // wire lines), so we keep one line per field everywhere for consistent UX.
  if (/[\r\n]/.test(question)) throw new Error('Question cannot contain line breaks');
  const cleanOptions = input.options.map((o) => o.trim()).filter((o) => o.length > 0);
  if (cleanOptions.length < POLL_MIN_OPTIONS) {
    throw new Error(`Need at least ${POLL_MIN_OPTIONS} options`);
  }
  if (cleanOptions.length > POLL_MAX_OPTIONS) {
    throw new Error(`At most ${POLL_MAX_OPTIONS} options`);
  }
  for (const o of cleanOptions) {
    if (o.length > POLL_MAX_OPTION_LENGTH) {
      throw new Error(`Option too long (max ${POLL_MAX_OPTION_LENGTH} chars)`);
    }
    if (/[\r\n]/.test(o)) throw new Error('Options cannot contain line breaks');
  }
  const pollType: PollType = input.pollType ?? 'singlechoice';
  const tags: string[][] = [];
  for (const pk of input.recipientPubkeys) tags.push(['p', pk]);
  cleanOptions.forEach((label, i) => tags.push(['option', optionIdForIndex(i), label]));
  tags.push(['polltype', pollType]);
  if (input.endsAt !== undefined) tags.push(['endsAt', String(input.endsAt)]);
  return {
    pubkey: input.senderPubkey,
    kind: POLL_KIND,
    created_at: input.createdAt ?? Math.floor(Date.now() / 1000),
    tags,
    // NIP-88: the poll's question/label lives in `content`.
    content: question,
  };
}

/**
 * Build a kind-1018 vote rumor: `e` → the poll rumor id, one `response` tag per
 * chosen option, `p` tags addressing the recipients (the poll author in a 1:1,
 * all members in a group). Unsigned — hand it to the NIP-17 gift-wrap send path.
 */
export function buildVoteRumor(input: {
  senderPubkey: string;
  recipientPubkeys: string[];
  pollId: string;
  optionIds: string[];
  createdAt?: number;
}): PollRumor {
  if (!input.pollId) throw new Error('pollId required');
  if (input.optionIds.length === 0) throw new Error('At least one option required');
  const tags: string[][] = [['e', input.pollId]];
  for (const pk of input.recipientPubkeys) tags.push(['p', pk]);
  for (const optId of input.optionIds) tags.push(['response', optId]);
  return {
    pubkey: input.senderPubkey,
    kind: VOTE_KIND,
    created_at: input.createdAt ?? Math.floor(Date.now() / 1000),
    tags,
    content: '',
  };
}

/** Parse a kind-1068 rumor into a display poll, or null when malformed. */
export function parsePollRumor(rumor: PollRumor): DisplayPoll | null {
  if (rumor.kind !== POLL_KIND) return null;
  if (!Array.isArray(rumor.tags)) return null;
  const question = typeof rumor.content === 'string' ? rumor.content.trim() : '';
  if (!question) return null;
  const options: PollOption[] = [];
  const seen = new Set<string>();
  for (const t of rumor.tags) {
    if (t[0] !== 'option') continue;
    const id = typeof t[1] === 'string' ? t[1] : undefined;
    const label = typeof t[2] === 'string' ? t[2].trim() : '';
    if (!id || !label) continue; // drop malformed options rather than crashing
    if (seen.has(id)) continue; // dedup by id — a stale client can't double a row
    seen.add(id);
    options.push({ id, label });
  }
  if (options.length < POLL_MIN_OPTIONS) return null;
  // Truncate (never reject) an over-long option set from a foreign client.
  if (options.length > POLL_MAX_OPTIONS) options.length = POLL_MAX_OPTIONS;
  const rawType = firstTagValue(rumor.tags, 'polltype');
  const pollType: PollType = rawType === 'multiplechoice' ? 'multiplechoice' : 'singlechoice';
  const endsAtRaw = firstTagValue(rumor.tags, 'endsAt');
  const endsAt =
    endsAtRaw !== undefined && /^\d+$/.test(endsAtRaw.trim())
      ? Number(endsAtRaw.trim())
      : undefined;
  return { question, options, pollType, endsAt };
}

/** Parse a kind-1018 rumor into its poll ref + chosen option ids, or null. */
export function parseVoteRumor(rumor: PollRumor): { pollId: string; optionIds: string[] } | null {
  if (rumor.kind !== VOTE_KIND) return null;
  if (!Array.isArray(rumor.tags)) return null;
  const pollId = firstTagValue(rumor.tags, 'e');
  if (!pollId) return null;
  const optionIds: string[] = [];
  for (const t of rumor.tags) {
    if (t[0] !== 'response') continue;
    if (typeof t[1] === 'string' && t[1].length > 0 && !optionIds.includes(t[1])) {
      optionIds.push(t[1]);
    }
  }
  if (optionIds.length === 0) return null;
  return { pollId, optionIds };
}

// ---------------------------------------------------------------------------
// Storage bridge (mirrors orderEvents.ts serialize/parseStored)
// ---------------------------------------------------------------------------

/**
 * Canonical stored form of a poll rumor: its display shape plus the poll id
 * (the rumor event id) and author. Called by `nip17Unwrap.textForRumor` on
 * ingest AND by the optimistic-send append, so both sides persist byte-identical
 * JSON (the rumor is deterministic → same hash → same JSON → local/echo dedup).
 * Returns null when the rumor isn't a well-formed poll.
 */
export function serializePollFromRumor(rumor: PollRumor): string | null {
  const poll = parsePollRumor(rumor);
  if (!poll) return null;
  let pollId: string;
  try {
    pollId = getEventHash(rumor);
  } catch {
    return null;
  }
  const stored: StoredPoll = { ...poll, pollId, author: rumor.pubkey.toLowerCase() };
  return JSON.stringify(stored);
}

/**
 * Canonical stored form of a vote rumor: the referenced poll id, the voter
 * (the rumor author), the chosen option ids, and the vote time. The voter is
 * baked in here so the tally has an accurate one-vote-per-pubkey key for BOTH
 * 1:1 and group threads without threading a per-row sender through the UI.
 */
export function serializeVoteFromRumor(rumor: PollRumor): string | null {
  const vote = parseVoteRumor(rumor);
  if (!vote) return null;
  const record: VoteRecord = {
    pollId: vote.pollId,
    voter: rumor.pubkey.toLowerCase(),
    optionIds: vote.optionIds,
    createdAt: rumor.created_at,
  };
  return JSON.stringify(record);
}

/** Inverse of `serializePollFromRumor`; null when `content` isn't a stored poll. */
export function parseStoredPoll(content: string): StoredPoll | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  if (typeof p.pollId !== 'string' || !p.pollId) return null;
  if (typeof p.question !== 'string' || !p.question) return null;
  if (typeof p.author !== 'string') return null;
  if (!Array.isArray(p.options)) return null;
  const options: PollOption[] = [];
  const seen = new Set<string>();
  for (const raw of p.options) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.label !== 'string') continue;
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    options.push({ id: o.id, label: o.label });
  }
  if (options.length < POLL_MIN_OPTIONS) return null;
  const pollType: PollType = p.pollType === 'multiplechoice' ? 'multiplechoice' : 'singlechoice';
  const endsAt =
    typeof p.endsAt === 'number' && Number.isFinite(p.endsAt) && p.endsAt > 0
      ? p.endsAt
      : undefined;
  return {
    pollId: p.pollId,
    author: p.author.toLowerCase(),
    question: p.question,
    options,
    pollType,
    endsAt,
  };
}

/** Inverse of `serializeVoteFromRumor`; null when `content` isn't a stored vote. */
export function parseStoredVote(content: string): VoteRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const v = parsed as Record<string, unknown>;
  if (typeof v.pollId !== 'string' || !v.pollId) return null;
  if (typeof v.voter !== 'string' || !v.voter) return null;
  if (!Array.isArray(v.optionIds)) return null;
  const optionIds = v.optionIds.filter((x): x is string => typeof x === 'string' && x.length > 0);
  if (optionIds.length === 0) return null;
  const createdAt =
    typeof v.createdAt === 'number' && Number.isFinite(v.createdAt) ? v.createdAt : 0;
  return { pollId: v.pollId, voter: v.voter.toLowerCase(), optionIds, createdAt };
}

/**
 * One-line inbox preview for a stored poll / vote row (mirrors
 * `orderPreviewFromContent`). Returns null for a non-poll wireKind so callers
 * can fall through to the order/plaintext preview.
 */
export function pollPreviewFromContent(content: string, wireKind: number): string | null {
  if (wireKind === POLL_KIND) {
    const poll = parseStoredPoll(content);
    return poll ? `📊 Poll: ${poll.question}` : '📊 Poll';
  }
  if (wireKind === VOTE_KIND) {
    // Only claim a vote happened when the stored content actually parses as a
    // vote — a corrupt / non-vote body falls back to a generic poll label so
    // the inbox never asserts a vote the row can't be interpreted as.
    return parseStoredVote(content) ? '📊 Voted on a poll' : '📊 Poll';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tally
// ---------------------------------------------------------------------------

/**
 * Aggregate votes for one poll, one vote per pubkey (latest `createdAt` wins),
 * respecting `polltype` and `endsAt`:
 *
 *  - Votes cast strictly AFTER `endsAt` are ignored (voting is closed).
 *  - Each voter's LATEST vote is the one counted (the "I clicked the wrong one"
 *    correction) — earlier votes from the same pubkey are discarded.
 *  - For `singlechoice`, only the first valid option of a voter's latest vote
 *    counts (a misbehaving client sending multiple responses can't stuff).
 *  - For `multiplechoice`, every valid option of the latest vote counts, but the
 *    voter is still only ONE towards `totalVoters`.
 *  - Options not present in the poll are dropped (a stale client voting on an
 *    edited-away option can't create a phantom row).
 */
export function tallyPoll(
  poll: StoredPoll,
  votes: VoteRecord[],
  viewerPubkey: string | null,
  now: number = Math.floor(Date.now() / 1000),
): PollTally {
  const validOptionIds = new Set(poll.options.map((o) => o.id));
  const counts = new Map<string, number>();
  for (const o of poll.options) counts.set(o.id, 0);

  // Latest vote per voter for THIS poll, ignoring post-close votes.
  const latestByVoter = new Map<string, VoteRecord>();
  for (const v of votes) {
    if (v.pollId !== poll.pollId) continue;
    if (poll.endsAt !== undefined && v.createdAt > poll.endsAt) continue;
    const prev = latestByVoter.get(v.voter);
    if (!prev || v.createdAt >= prev.createdAt) latestByVoter.set(v.voter, v);
  }

  let totalVoters = 0;
  let myVotes: string[] = [];
  const viewer = viewerPubkey ? viewerPubkey.toLowerCase() : null;
  for (const [voter, v] of latestByVoter) {
    const chosen = v.optionIds.filter((id) => validOptionIds.has(id));
    if (chosen.length === 0) continue;
    const applied = poll.pollType === 'singlechoice' ? [chosen[0]] : Array.from(new Set(chosen));
    for (const id of applied) counts.set(id, (counts.get(id) ?? 0) + 1);
    totalVoters++;
    if (viewer && voter === viewer) myVotes = applied;
  }

  const closed = poll.endsAt !== undefined && now >= poll.endsAt;
  return {
    pollId: poll.pollId,
    question: poll.question,
    options: poll.options.map((o) => ({ id: o.id, label: o.label, count: counts.get(o.id) ?? 0 })),
    totalVoters,
    myVotes,
    closed,
  };
}

/**
 * Adapt a legacy text-encoded poll (`pollMessage.ParsedPoll`, numeric ids) into
 * a `StoredPoll` so the SAME renderer + tally serve both wire formats. `pollId`
 * is the caller-supplied correlation id (the legacy poll message's item id).
 */
export function legacyPollToStored(
  pollId: string,
  parsed: { question: string; options: { id: number; text: string }[] },
): StoredPoll {
  return {
    pollId,
    author: '',
    question: parsed.question,
    options: parsed.options.map((o) => ({ id: String(o.id), label: o.text })),
    pollType: 'singlechoice',
    endsAt: undefined,
  };
}

/** True when a pubkey is a well-formed 64-char hex key (guards vote voters). */
export function isHexPubkey(value: string): boolean {
  return HEX64.test(value.toLowerCase());
}
