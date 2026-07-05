import { getEventHash } from 'nostr-tools/pure';
import {
  POLL_KIND,
  VOTE_KIND,
  POLL_MAX_OPTIONS,
  POLL_MAX_QUESTION_LENGTH,
  POLL_MAX_OPTION_LENGTH,
  buildPollRumor,
  buildVoteRumor,
  parsePollRumor,
  parseVoteRumor,
  serializePollFromRumor,
  serializeVoteFromRumor,
  parseStoredPoll,
  parseStoredVote,
  pollPreviewFromContent,
  tallyPoll,
  legacyPollToStored,
  type StoredPoll,
  type VoteRecord,
} from './nip88Poll';

const A = 'a'.repeat(64); // author / voter 1
const B = 'b'.repeat(64); // voter 2
const C = 'c'.repeat(64); // voter 3
const PEER = 'd'.repeat(64);

describe('nip88Poll — poll rumor build/parse', () => {
  it('builds a kind-1068 rumor with option/polltype/p tags', () => {
    const rumor = buildPollRumor({
      senderPubkey: A,
      recipientPubkeys: [PEER],
      question: '  What shall we cook?  ',
      options: [' Pasta ', 'Curry', ''],
      createdAt: 1000,
    });
    expect(rumor.kind).toBe(POLL_KIND);
    expect(rumor.content).toBe('What shall we cook?'); // trimmed, empty option dropped
    expect(rumor.tags).toContainEqual(['p', PEER]);
    expect(rumor.tags).toContainEqual(['option', '1', 'Pasta']);
    expect(rumor.tags).toContainEqual(['option', '2', 'Curry']);
    expect(rumor.tags).toContainEqual(['polltype', 'singlechoice']);
    expect(rumor.tags.find((t) => t[0] === 'option' && t[1] === '3')).toBeUndefined();
  });

  it('honours multiplechoice + endsAt', () => {
    const rumor = buildPollRumor({
      senderPubkey: A,
      recipientPubkeys: [PEER],
      question: 'Pick some',
      options: ['x', 'y'],
      pollType: 'multiplechoice',
      endsAt: 5000,
    });
    expect(rumor.tags).toContainEqual(['polltype', 'multiplechoice']);
    expect(rumor.tags).toContainEqual(['endsAt', '5000']);
    const parsed = parsePollRumor(rumor);
    expect(parsed?.pollType).toBe('multiplechoice');
    expect(parsed?.endsAt).toBe(5000);
  });

  it('rejects too few options and over-long question', () => {
    expect(() =>
      buildPollRumor({
        senderPubkey: A,
        recipientPubkeys: [PEER],
        question: 'q',
        options: ['only'],
      }),
    ).toThrow(/at least/i);
    expect(() =>
      buildPollRumor({
        senderPubkey: A,
        recipientPubkeys: [PEER],
        question: 'x'.repeat(300),
        options: ['a', 'b'],
      }),
    ).toThrow(/too long/i);
  });

  it('rejects embedded newlines in question or options', () => {
    expect(() =>
      buildPollRumor({
        senderPubkey: A,
        recipientPubkeys: [PEER],
        question: 'line1\nline2',
        options: ['a', 'b'],
      }),
    ).toThrow(/line breaks/i);
    expect(() =>
      buildPollRumor({
        senderPubkey: A,
        recipientPubkeys: [PEER],
        question: 'ok',
        options: ['a', 'b\ninjected'],
      }),
    ).toThrow(/line breaks/i);
  });

  it('parsePollRumor returns null for non-1068 or malformed', () => {
    expect(
      parsePollRumor({ pubkey: A, kind: 14, created_at: 1, tags: [], content: 'hi' }),
    ).toBeNull();
    expect(
      parsePollRumor({
        pubkey: A,
        kind: POLL_KIND,
        created_at: 1,
        tags: [['option', '1', 'a']],
        content: '',
      }),
    ).toBeNull(); // no question
    expect(
      parsePollRumor({
        pubkey: A,
        kind: POLL_KIND,
        created_at: 1,
        tags: [['option', '1', 'a']],
        content: 'q',
      }),
    ).toBeNull(); // <2 options
  });

  it('parsePollRumor truncates an over-long incoming question + option labels to their caps', () => {
    const parsed = parsePollRumor({
      pubkey: A,
      kind: POLL_KIND,
      created_at: 1,
      tags: [
        ['option', '1', 'x'.repeat(POLL_MAX_OPTION_LENGTH + 40)],
        ['option', '2', 'ok'],
      ],
      content: 'q'.repeat(POLL_MAX_QUESTION_LENGTH + 100),
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.question).toHaveLength(POLL_MAX_QUESTION_LENGTH);
    expect(parsed!.options[0].label).toHaveLength(POLL_MAX_OPTION_LENGTH);
    expect(parsed!.options[1].label).toBe('ok');
  });
});

describe('nip88Poll — vote rumor build/parse', () => {
  it('builds a kind-1018 rumor with e + response + p tags', () => {
    const rumor = buildVoteRumor({
      senderPubkey: B,
      recipientPubkeys: [A],
      pollId: 'poll123',
      optionIds: ['2'],
      createdAt: 2000,
    });
    expect(rumor.kind).toBe(VOTE_KIND);
    expect(rumor.tags).toContainEqual(['e', 'poll123']);
    expect(rumor.tags).toContainEqual(['p', A]);
    expect(rumor.tags).toContainEqual(['response', '2']);
    const parsed = parseVoteRumor(rumor);
    expect(parsed).toEqual({ pollId: 'poll123', optionIds: ['2'] });
  });

  it('parseVoteRumor dedups responses and rejects missing e', () => {
    expect(
      parseVoteRumor({
        pubkey: B,
        kind: VOTE_KIND,
        created_at: 1,
        tags: [['response', '1']],
        content: '',
      }),
    ).toBeNull();
    const multi = parseVoteRumor({
      pubkey: B,
      kind: VOTE_KIND,
      created_at: 1,
      tags: [
        ['e', 'p1'],
        ['response', '1'],
        ['response', '2'],
        ['response', '1'],
      ],
      content: '',
    });
    expect(multi).toEqual({ pollId: 'p1', optionIds: ['1', '2'] });
  });

  it('parseVoteRumor clamps to POLL_MAX_OPTIONS unique responses', () => {
    const many = parseVoteRumor({
      pubkey: B,
      kind: VOTE_KIND,
      created_at: 1,
      tags: [
        ['e', 'p1'],
        // 10 distinct responses — a well-formed vote can reference at most 6.
        ...Array.from({ length: 10 }, (_, i) => ['response', `opt${i}`]),
      ],
      content: '',
    });
    expect(many).not.toBeNull();
    expect(many!.optionIds).toHaveLength(POLL_MAX_OPTIONS);
    expect(many!.optionIds[0]).toBe('opt0');
  });
});

describe('nip88Poll — storage bridge', () => {
  it('serializes a poll with the rumor event id as pollId, round-trips', () => {
    const rumor = buildPollRumor({
      senderPubkey: A,
      recipientPubkeys: [PEER],
      question: 'Q?',
      options: ['a', 'b'],
      createdAt: 100,
    });
    const json = serializePollFromRumor(rumor);
    expect(json).not.toBeNull();
    const stored = parseStoredPoll(json!);
    expect(stored?.pollId).toBe(getEventHash(rumor));
    expect(stored?.author).toBe(A);
    expect(stored?.options).toEqual([
      { id: '1', label: 'a' },
      { id: '2', label: 'b' },
    ]);
  });

  it('serialization is deterministic (sender optimistic == recipient echo)', () => {
    const rumor = buildPollRumor({
      senderPubkey: A,
      recipientPubkeys: [PEER],
      question: 'Q?',
      options: ['a', 'b'],
      createdAt: 100,
    });
    // A second identical DecodedRumor (as an echo would present) → same JSON.
    const echo = { ...rumor };
    expect(serializePollFromRumor(rumor)).toBe(serializePollFromRumor(echo));
  });

  it('serializes a vote capturing the voter from the rumor pubkey', () => {
    const rumor = buildVoteRumor({
      senderPubkey: B,
      recipientPubkeys: [A],
      pollId: 'poll1',
      optionIds: ['1'],
      createdAt: 200,
    });
    const stored = parseStoredVote(serializeVoteFromRumor(rumor)!);
    expect(stored).toEqual({ pollId: 'poll1', voter: B, optionIds: ['1'], createdAt: 200 });
  });

  it('pollPreviewFromContent labels polls and votes, null otherwise', () => {
    const pollJson = serializePollFromRumor(
      buildPollRumor({
        senderPubkey: A,
        recipientPubkeys: [PEER],
        question: 'Dinner?',
        options: ['a', 'b'],
      }),
    )!;
    expect(pollPreviewFromContent(pollJson, POLL_KIND)).toBe('📊 Poll: Dinner?');
    const voteJson = serializeVoteFromRumor(
      buildVoteRumor({
        senderPubkey: A,
        recipientPubkeys: [PEER],
        pollId: 'poll-1',
        optionIds: ['a'],
      }),
    )!;
    expect(pollPreviewFromContent(voteJson, VOTE_KIND)).toBe('📊 Voted on a poll');
    expect(pollPreviewFromContent('hi', 14)).toBeNull();
  });

  it('pollPreviewFromContent does not claim a vote for corrupt vote content', () => {
    // Row is a vote wireKind but the body doesn't parse as a vote — the inbox
    // must fall back to a generic label rather than asserting a vote happened.
    expect(pollPreviewFromContent('{}', VOTE_KIND)).toBe('📊 Poll');
    expect(pollPreviewFromContent('not json', VOTE_KIND)).toBe('📊 Poll');
    expect(pollPreviewFromContent(JSON.stringify({ pollId: 'x', optionIds: [] }), VOTE_KIND)).toBe(
      '📊 Poll',
    );
  });

  it('parseStoredPoll/Vote reject corrupt JSON', () => {
    expect(parseStoredPoll('not json')).toBeNull();
    expect(parseStoredPoll(JSON.stringify({ pollId: 'x' }))).toBeNull();
    expect(parseStoredVote('nope')).toBeNull();
    expect(parseStoredVote(JSON.stringify({ pollId: 'x', voter: A, optionIds: [] }))).toBeNull();
  });
});

describe('nip88Poll — tally', () => {
  const poll: StoredPoll = {
    pollId: 'poll1',
    author: A,
    question: 'Q?',
    options: [
      { id: '1', label: 'a' },
      { id: '2', label: 'b' },
      { id: '3', label: 'c' },
    ],
    pollType: 'singlechoice',
  };
  const v = (voter: string, optionIds: string[], createdAt: number): VoteRecord => ({
    pollId: 'poll1',
    voter,
    optionIds,
    createdAt,
  });

  it('counts one vote per pubkey, latest wins', () => {
    const t = tallyPoll(poll, [v(A, ['1'], 10), v(A, ['2'], 20), v(B, ['2'], 15)], A, 30);
    expect(t.totalVoters).toBe(2);
    expect(t.options.find((o) => o.id === '1')!.count).toBe(0); // A's earlier vote overridden
    expect(t.options.find((o) => o.id === '2')!.count).toBe(2); // A(latest) + B
    expect(t.myVotes).toEqual(['2']);
    expect(t.closed).toBe(false);
  });

  it('singlechoice ignores extra options on one vote', () => {
    const t = tallyPoll(poll, [v(A, ['1', '2', '3'], 10)], A, 30);
    expect(t.totalVoters).toBe(1);
    expect(t.options.find((o) => o.id === '1')!.count).toBe(1);
    expect(t.options.find((o) => o.id === '2')!.count).toBe(0);
  });

  it('multiplechoice counts every chosen option but one voter', () => {
    const multi: StoredPoll = { ...poll, pollType: 'multiplechoice' };
    const t = tallyPoll(multi, [v(A, ['1', '3'], 10), v(B, ['1'], 12)], A, 30);
    expect(t.totalVoters).toBe(2);
    expect(t.options.find((o) => o.id === '1')!.count).toBe(2);
    expect(t.options.find((o) => o.id === '3')!.count).toBe(1);
    expect(t.myVotes).toEqual(['1', '3']);
  });

  it('respects endsAt — post-close votes ignored, closed flag set', () => {
    const timed: StoredPoll = { ...poll, endsAt: 100 };
    const t = tallyPoll(timed, [v(A, ['1'], 50), v(B, ['2'], 150)], A, 200);
    expect(t.totalVoters).toBe(1); // B's vote was after endsAt
    expect(t.options.find((o) => o.id === '1')!.count).toBe(1);
    expect(t.closed).toBe(true);
  });

  it('drops votes for options that do not exist', () => {
    const t = tallyPoll(poll, [v(A, ['99'], 10)], A, 30);
    expect(t.totalVoters).toBe(0);
  });

  it('legacyPollToStored adapts numeric-id polls', () => {
    const stored = legacyPollToStored('dm-x', {
      question: 'Legacy?',
      options: [
        { id: 1, text: 'a' },
        { id: 2, text: 'b' },
      ],
    });
    expect(stored.pollId).toBe('dm-x');
    expect(stored.pollType).toBe('singlechoice');
    const t = tallyPoll(
      stored,
      [{ pollId: 'dm-x', voter: C, optionIds: ['1'], createdAt: 5 }],
      C,
      10,
    );
    expect(t.options.find((o) => o.id === '1')!.count).toBe(1);
    expect(t.myVotes).toEqual(['1']);
  });
});
