/**
 * Wire-format + aggregator tests for the in-conversation poll protocol
 * (#203). The parser is the boundary that turns user input + foreign
 * messages into a renderable poll, so we exercise both happy path and
 * the malformed shapes the renderer would otherwise have to defend
 * against.
 */

import {
  POLL_HEADER,
  POLL_VOTE_PREFIX,
  POLL_MAX_OPTIONS,
  aggregateVotes,
  buildPollMessage,
  buildVoteMessage,
  isPollMessage,
  isPollVoteMessage,
  parsePoll,
  parseVote,
  type PollVoteRecord,
} from './pollMessage';

describe('buildPollMessage', () => {
  it('serialises a question + options into the wire shape', () => {
    const text = buildPollMessage('What time?', ['7pm', '8pm', '9pm']);
    expect(text).toBe(
      [POLL_HEADER, 'question: What time?', 'option:1: 7pm', 'option:2: 8pm', 'option:3: 9pm'].join(
        '\n',
      ),
    );
  });

  it('rejects an empty question', () => {
    expect(() => buildPollMessage('', ['a', 'b'])).toThrow(/question/i);
    expect(() => buildPollMessage('   ', ['a', 'b'])).toThrow(/question/i);
  });

  it('rejects fewer than the minimum options', () => {
    expect(() => buildPollMessage('Q', ['only-one'])).toThrow(/options/i);
  });

  it('drops empty option strings before counting', () => {
    expect(() => buildPollMessage('Q', ['only', '   '])).toThrow(/options/i);
  });

  it('rejects more than the maximum options', () => {
    const tooMany = Array.from({ length: POLL_MAX_OPTIONS + 1 }, (_, i) => `opt${i + 1}`);
    expect(() => buildPollMessage('Q', tooMany)).toThrow(/most/i);
  });

  it('rejects an over-long question', () => {
    expect(() => buildPollMessage('x'.repeat(500), ['a', 'b'])).toThrow(/long/i);
  });

  it('round-trips through parsePoll', () => {
    const text = buildPollMessage('What time?', ['7pm', '8pm']);
    const parsed = parsePoll(text);
    expect(parsed).toEqual({
      question: 'What time?',
      options: [
        { id: 1, text: '7pm' },
        { id: 2, text: '8pm' },
      ],
    });
  });
});

describe('parsePoll', () => {
  it('returns null for empty input', () => {
    expect(parsePoll('')).toBeNull();
    expect(parsePoll('   ')).toBeNull();
  });

  it('returns null when the header is missing', () => {
    expect(parsePoll('question: hi\noption:1: a\noption:2: b')).toBeNull();
  });

  it('returns null when the header is not the first non-blank line', () => {
    // A poll-mention inside another message must NOT trigger a poll bubble.
    const text = `Look at this ${POLL_HEADER} thing\nquestion: x\noption:1: a\noption:2: b`;
    expect(parsePoll(text)).toBeNull();
  });

  it('tolerates leading blank lines', () => {
    const text = `\n\n${POLL_HEADER}\nquestion: Q\noption:1: a\noption:2: b`;
    expect(parsePoll(text)?.question).toBe('Q');
  });

  it('returns null when there is no question line', () => {
    const text = `${POLL_HEADER}\noption:1: a\noption:2: b`;
    expect(parsePoll(text)).toBeNull();
  });

  it('returns null when fewer than 2 options', () => {
    const text = `${POLL_HEADER}\nquestion: Q\noption:1: a`;
    expect(parsePoll(text)).toBeNull();
  });

  it('truncates more than POLL_MAX_OPTIONS options', () => {
    const lines = [POLL_HEADER, 'question: Q'];
    for (let i = 1; i <= POLL_MAX_OPTIONS + 3; i++) lines.push(`option:${i}: opt${i}`);
    const parsed = parsePoll(lines.join('\n'));
    expect(parsed?.options.length).toBe(POLL_MAX_OPTIONS);
    expect(parsed?.options[0].id).toBe(1);
  });

  it('ignores duplicate option ids (first wins)', () => {
    const text = `${POLL_HEADER}\nquestion: Q\noption:1: a\noption:1: dup\noption:2: b`;
    const parsed = parsePoll(text);
    expect(parsed?.options).toEqual([
      { id: 1, text: 'a' },
      { id: 2, text: 'b' },
    ]);
  });

  it('ignores unknown lines (forward-compat)', () => {
    const text = `${POLL_HEADER}\nquestion: Q\nmode: single\noption:1: a\noption:2: b\ncloses_at: 9999`;
    const parsed = parsePoll(text);
    expect(parsed?.options.length).toBe(2);
  });

  it('preserves question text verbatim — no case-folding', () => {
    const text = `${POLL_HEADER}\nquestion: What TIME shall we EAT?\noption:1: 6\noption:2: 8`;
    expect(parsePoll(text)?.question).toBe('What TIME shall we EAT?');
  });
});

describe('parseVote', () => {
  it('parses a well-formed vote line', () => {
    expect(parseVote(`${POLL_VOTE_PREFIX} dm-abc 2`)).toEqual({ pollId: 'dm-abc', optionId: 2 });
  });

  it('rejects non-vote text', () => {
    expect(parseVote('hi')).toBeNull();
    expect(parseVote('')).toBeNull();
  });

  it('rejects extra trailing tokens', () => {
    expect(parseVote(`${POLL_VOTE_PREFIX} id 1 extra`)).toBeNull();
  });

  it('rejects non-integer optionId', () => {
    expect(parseVote(`${POLL_VOTE_PREFIX} id abc`)).toBeNull();
    expect(parseVote(`${POLL_VOTE_PREFIX} id 1.5`)).toBeNull();
    expect(parseVote(`${POLL_VOTE_PREFIX} id 0`)).toBeNull();
  });
});

describe('isPollMessage / isPollVoteMessage', () => {
  it('classifies a poll body', () => {
    const text = buildPollMessage('Q', ['a', 'b']);
    expect(isPollMessage(text)).toBe(true);
    expect(isPollVoteMessage(text)).toBe(false);
  });

  it('classifies a vote body', () => {
    const text = buildVoteMessage('poll-1', 1);
    expect(isPollVoteMessage(text)).toBe(true);
    expect(isPollMessage(text)).toBe(false);
  });

  it('does not misclassify plain text', () => {
    expect(isPollMessage('hello')).toBe(false);
    expect(isPollVoteMessage('hello')).toBe(false);
  });
});

describe('aggregateVotes', () => {
  const PK_ALICE = 'a'.repeat(64);
  const PK_BOB = 'b'.repeat(64);
  const PK_VIEWER = 'c'.repeat(64);

  function poll(id: string, optionCount = 3) {
    const options = Array.from({ length: optionCount }, (_, i) => ({
      id: i + 1,
      text: `opt${i + 1}`,
    }));
    return { id, poll: { question: `Q-${id}`, options } };
  }

  function vote(
    pollId: string,
    voter: string,
    optionId: number,
    createdAt: number,
  ): PollVoteRecord {
    return { pollId, voter, optionId, createdAt };
  }

  it('counts each voter once', () => {
    const polls = [poll('p1')];
    const votes = [vote('p1', PK_ALICE, 1, 100), vote('p1', PK_BOB, 2, 100)];
    const agg = aggregateVotes(polls, votes, null);
    const p1 = agg.get('p1')!;
    expect(p1.totalVotes).toBe(2);
    expect(p1.options.find((o) => o.id === 1)?.count).toBe(1);
    expect(p1.options.find((o) => o.id === 2)?.count).toBe(1);
  });

  it('applies last-vote-wins per voter', () => {
    const polls = [poll('p1')];
    // Alice: 1 → 3 → 2. Final tally puts her on option 2.
    const votes = [
      vote('p1', PK_ALICE, 1, 100),
      vote('p1', PK_ALICE, 3, 110),
      vote('p1', PK_ALICE, 2, 120),
    ];
    const agg = aggregateVotes(polls, votes, null);
    const p1 = agg.get('p1')!;
    expect(p1.totalVotes).toBe(1);
    expect(p1.options.find((o) => o.id === 2)?.count).toBe(1);
    expect(p1.options.find((o) => o.id === 1)?.count).toBe(0);
    expect(p1.options.find((o) => o.id === 3)?.count).toBe(0);
  });

  it('flags myVote when the viewer participated', () => {
    const polls = [poll('p1')];
    const votes = [vote('p1', PK_VIEWER, 2, 100), vote('p1', PK_BOB, 1, 100)];
    const agg = aggregateVotes(polls, votes, PK_VIEWER);
    expect(agg.get('p1')!.myVote).toBe(2);
  });

  it('returns null myVote when viewer abstained', () => {
    const polls = [poll('p1')];
    const votes = [vote('p1', PK_BOB, 1, 100)];
    const agg = aggregateVotes(polls, votes, PK_VIEWER);
    expect(agg.get('p1')!.myVote).toBeNull();
  });

  it('drops votes for options the poll does not have', () => {
    const polls = [poll('p1', 2)];
    const votes = [vote('p1', PK_ALICE, 99, 100)];
    const agg = aggregateVotes(polls, votes, null);
    expect(agg.get('p1')!.totalVotes).toBe(0);
  });

  it('handles polls with no votes', () => {
    const polls = [poll('p1')];
    const agg = aggregateVotes(polls, [], PK_VIEWER);
    const p1 = agg.get('p1')!;
    expect(p1.totalVotes).toBe(0);
    expect(p1.myVote).toBeNull();
    p1.options.forEach((o) => expect(o.count).toBe(0));
  });

  it('isolates votes per poll', () => {
    const polls = [poll('p1'), poll('p2')];
    const votes = [
      vote('p1', PK_ALICE, 1, 100),
      vote('p2', PK_ALICE, 2, 100),
      vote('p2', PK_BOB, 2, 100),
    ];
    const agg = aggregateVotes(polls, votes, null);
    expect(agg.get('p1')!.totalVotes).toBe(1);
    expect(agg.get('p2')!.totalVotes).toBe(2);
    expect(agg.get('p2')!.options.find((o) => o.id === 2)?.count).toBe(2);
  });
});
