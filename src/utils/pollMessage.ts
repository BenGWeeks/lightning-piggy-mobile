/**
 * Text-encoded poll protocol for in-conversation polls (#203).
 *
 * --- Why a text encoding (Option A), not NIP-88? ---
 * The issue prefers NIP-88 (kind 1068 + 1018) for cross-client interop.
 * For this MVP we instead encode the poll as a structured plain-text body
 * inside the existing NIP-17 DM rumor. Trade-offs:
 *
 *   + Ships entirely on the existing send/receive pipeline — no new event
 *     kinds, no new subscription filters, no per-relay capability check.
 *     Polls survive the same round-trip the rest of the chat already
 *     proves (cache, persist, replay, notify).
 *   + Vote tally is materialised from the same conversation history that
 *     drives the bubbles, so cold-start renders accurate counts as soon
 *     as the FlatList lights up — no extra fetch path.
 *   - Foreign Nostr clients (Damus, Amethyst, …) render the poll as
 *     plain text, not a tappable poll. Voting is in-app only.
 *   - Tally is bounded to votes the local client has decrypted — same
 *     visibility limit as the messages themselves, but worth flagging.
 *
 * Migration to NIP-88 is intended as a follow-up once the spec stabilises;
 * the parser + aggregator surface here is intentionally narrow so a
 * second protocol can plug in alongside without re-shaping MessageBubble.
 *
 * --- Wire format ---
 * Poll body (sent as the DM text):
 *
 *     [POLL]
 *     question: <question text, single line>
 *     option:1: <option text>
 *     option:2: <option text>
 *     option:3: <option text>
 *
 * Vote body (a follow-up DM the recipient sends after tapping an option):
 *
 *     [POLL_VOTE] <poll_id> <option_id>
 *
 * `poll_id` is the poll-message's id within the conversation (the locally
 * stable id — for incoming this is the rumor event id, for outgoing local
 * sends it's the optimistic `local-…` id). Vote messages always show as
 * plain-text bubbles to other clients; in-app we hide them from the
 * conversation list and surface them only as aggregated tally.
 */

export const POLL_HEADER = '[POLL]';
export const POLL_VOTE_PREFIX = '[POLL_VOTE]';

// Hard caps on shape so a malformed paste can never blow up the renderer.
// The minimum two options matches every poll UI users have ever seen; six
// is what the issue asks for (single-tap reachability + readable card).
export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 6;
export const POLL_MAX_QUESTION_LENGTH = 200;
export const POLL_MAX_OPTION_LENGTH = 80;

export interface ParsedPoll {
  question: string;
  /** Ordered options. `id` is `1`-based and stable across the poll's lifetime. */
  options: { id: number; text: string }[];
}

export interface ParsedVote {
  pollId: string;
  optionId: number;
}

/** Compose a poll body from a question + ordered option strings. */
export function buildPollMessage(question: string, options: string[]): string {
  const trimmedQ = question.trim();
  if (!trimmedQ) throw new Error('Poll question is required');
  if (trimmedQ.length > POLL_MAX_QUESTION_LENGTH) {
    throw new Error(`Question too long (max ${POLL_MAX_QUESTION_LENGTH} chars)`);
  }
  const cleanOptions = options.map((o) => o.trim()).filter((o) => o.length > 0);
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
  }
  const lines = [POLL_HEADER, `question: ${trimmedQ}`];
  cleanOptions.forEach((text, i) => {
    lines.push(`option:${i + 1}: ${text}`);
  });
  return lines.join('\n');
}

/** Compose a vote body referring back to a poll-message id. */
export function buildVoteMessage(pollId: string, optionId: number): string {
  if (!pollId) throw new Error('pollId required');
  if (!Number.isInteger(optionId) || optionId < 1) {
    throw new Error('optionId must be a positive integer');
  }
  return `${POLL_VOTE_PREFIX} ${pollId} ${optionId}`;
}

/**
 * Parse a poll body. Returns `null` for anything that isn't a well-formed
 * poll — missing header, no question, fewer than the minimum options, or a
 * shape mismatch. The renderer falls back to plain-text in that case.
 */
export function parsePoll(text: string): ParsedPoll | null {
  if (!text) return null;
  // Allow leading whitespace but the very first non-empty line MUST be the
  // header. This stops the parser firing on an in-message reference like
  // "Look at this [POLL] in another room" when it isn't actually a poll.
  const lines = text.split(/\r?\n/);
  // Skip leading blank lines only (preserves the "header must be first")
  // semantic without being brittle about a trailing newline at the top.
  let cursor = 0;
  while (cursor < lines.length && lines[cursor].trim() === '') cursor++;
  if (cursor >= lines.length || lines[cursor].trim() !== POLL_HEADER) return null;
  cursor++;

  let question: string | null = null;
  const options: { id: number; text: string }[] = [];

  for (; cursor < lines.length; cursor++) {
    const raw = lines[cursor];
    const line = raw.trim();
    if (line === '') continue;
    if (line.toLowerCase().startsWith('question:')) {
      // Strip the leading `question:` (case-insensitive) and use the rest.
      // We lowercase only the prefix probe — never the value itself —
      // because question text is user content.
      question = raw.slice(raw.indexOf(':') + 1).trim();
      continue;
    }
    const optMatch = /^option:(\d+):\s?(.*)$/i.exec(line);
    if (optMatch) {
      const id = Number(optMatch[1]);
      const optText = optMatch[2].trim();
      // Drop empty / out-of-range / duplicate-id options. Better to silently
      // ignore than to crash the bubble on a malformed poll.
      if (!Number.isInteger(id) || id < 1) continue;
      if (!optText) continue;
      if (options.some((o) => o.id === id)) continue;
      options.push({ id, text: optText });
      continue;
    }
    // Unknown line — ignored. Lets us forward-compat new fields
    // (e.g. `mode: single`, `closes_at: …`) without breaking older
    // clients that only know the v1 keys.
  }

  if (!question) return null;
  if (options.length < POLL_MIN_OPTIONS) return null;
  if (options.length > POLL_MAX_OPTIONS) {
    // Truncate rather than reject — a foreign client publishing more
    // than we support shouldn't kill rendering. Order is preserved.
    options.length = POLL_MAX_OPTIONS;
  }

  return { question, options };
}

/** Parse a vote body. Returns `null` if the line isn't a valid vote ref. */
export function parseVote(text: string): ParsedVote | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith(POLL_VOTE_PREFIX)) return null;
  const rest = trimmed.slice(POLL_VOTE_PREFIX.length).trim();
  // Two whitespace-separated tokens: <pollId> <optionId>. We don't
  // accept extra trailing tokens — keeping the wire format strict
  // makes accidental matches against user-typed text near-impossible.
  const parts = rest.split(/\s+/);
  if (parts.length !== 2) return null;
  const [pollId, optionRaw] = parts;
  if (!pollId) return null;
  const optionId = Number(optionRaw);
  if (!Number.isInteger(optionId) || optionId < 1) return null;
  return { pollId, optionId };
}

/** Return true when this message is the head of a poll bubble (the question). */
export function isPollMessage(text: string): boolean {
  return parsePoll(text) !== null;
}

/** Return true when this message is a poll-vote follow-up. */
export function isPollVoteMessage(text: string): boolean {
  return parseVote(text) !== null;
}

export interface PollVoteRecord {
  /** Id of the poll-message this vote refers to (matches the bubble's `id`). */
  pollId: string;
  /** Hex pubkey of the voter. */
  voter: string;
  /** Selected option id within the referenced poll. */
  optionId: number;
  /** When the vote landed (epoch seconds). Used for last-write-wins. */
  createdAt: number;
}

export interface PollAggregate {
  pollId: string;
  question: string;
  options: { id: number; text: string; count: number }[];
  totalVotes: number;
  /** The current viewer's vote, if any. `null` when they haven't voted. */
  myVote: number | null;
}

/**
 * Build per-poll aggregates over a conversation history. Each voter is
 * counted at most once per poll — last vote wins (sorted by createdAt asc),
 * matching what users expect after the "I clicked the wrong one" tap.
 *
 * The shape is tuned for direct rendering: each option already carries
 * its display text + tally, so the bubble doesn't have to cross-reference
 * a separate options list.
 */
export function aggregateVotes(
  polls: { id: string; poll: ParsedPoll }[],
  votes: PollVoteRecord[],
  viewerPubkey: string | null,
  pollIdToVotes?: Map<string, PollVoteRecord[]>,
): Map<string, PollAggregate> {
  const out = new Map<string, PollAggregate>();
  // Pre-bucket votes per poll for O(votes + polls) instead of O(polls·votes)
  // — conversations can carry hundreds of votes once a few polls exist.
  const buckets = pollIdToVotes ?? new Map<string, PollVoteRecord[]>();
  if (!pollIdToVotes) {
    for (const v of votes) {
      const list = buckets.get(v.pollId) ?? [];
      list.push(v);
      buckets.set(v.pollId, list);
    }
  }
  for (const { id, poll } of polls) {
    const optionCounts = new Map<number, number>();
    for (const opt of poll.options) optionCounts.set(opt.id, 0);
    let myVote: number | null = null;
    const bucket = buckets.get(id) ?? [];
    // Last-vote-wins per voter — sort by createdAt then take the final pick.
    // Reusing a Map ensures each voter contributes exactly one tally.
    const lastByVoter = new Map<string, PollVoteRecord>();
    const sorted = [...bucket].sort((a, b) => a.createdAt - b.createdAt);
    for (const v of sorted) {
      // Drop votes for options that don't exist in the poll — protects
      // against a stale client voting on an option that was edited away.
      if (!optionCounts.has(v.optionId)) continue;
      lastByVoter.set(v.voter, v);
    }
    let totalVotes = 0;
    for (const v of lastByVoter.values()) {
      optionCounts.set(v.optionId, (optionCounts.get(v.optionId) ?? 0) + 1);
      totalVotes++;
      if (viewerPubkey && v.voter === viewerPubkey) {
        myVote = v.optionId;
      }
    }
    out.set(id, {
      pollId: id,
      question: poll.question,
      options: poll.options.map((o) => ({
        id: o.id,
        text: o.text,
        count: optionCounts.get(o.id) ?? 0,
      })),
      totalVotes,
      myVote,
    });
  }
  return out;
}
