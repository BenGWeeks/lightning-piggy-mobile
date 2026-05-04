/**
 * Unit tests for the NIP-25 reaction state-merge logic. These cover the
 * pure helpers in `reactions.ts` — no Nostr / network involved.
 *
 * The aggregator (`reduceReactions`) is the load-bearing piece: incoming
 * relay batches are unsorted and may include duplicates from spammy
 * clients. The merge has to be deterministic across delivery order.
 */

import {
  buildReactionEvent,
  buildReactionDeletionEvent,
  parseReactionEvent,
  reduceReactions,
  applyReactionDeletion,
  type ReactionRecord,
} from './reactions';

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);
const PK_C = 'c'.repeat(64);
const PK_ME = '0'.repeat(64);
const TARGET_1 = '1'.repeat(64);
const TARGET_2 = '2'.repeat(64);

function rec(
  reactor: string,
  emoji: string,
  target: string,
  createdAt: number,
  id?: string,
): ReactionRecord {
  return {
    id: id ?? `${reactor.slice(0, 4)}-${emoji}-${target.slice(0, 4)}-${createdAt}`,
    reactorPubkey: reactor,
    emoji,
    createdAt,
    targetEventId: target,
  };
}

describe('buildReactionEvent', () => {
  it('produces a kind-7 with e + p tags', () => {
    const ev = buildReactionEvent('🔥', TARGET_1, PK_A);
    expect(ev.kind).toBe(7);
    expect(ev.content).toBe('🔥');
    expect(ev.tags).toEqual(
      expect.arrayContaining([
        ['e', TARGET_1],
        ['p', PK_A],
      ]),
    );
  });

  it('lowercases the author pubkey in the p tag', () => {
    const ev = buildReactionEvent('👍', TARGET_1, 'A'.repeat(64));
    const pTag = ev.tags.find((t) => t[0] === 'p');
    expect(pTag?.[1]).toBe('a'.repeat(64));
  });

  it('appends a k tag when the kind hint is provided', () => {
    const ev = buildReactionEvent('❤️', TARGET_1, PK_A, 14);
    const kTag = ev.tags.find((t) => t[0] === 'k');
    expect(kTag).toEqual(['k', '14']);
  });

  it('omits the k tag when no kind hint is provided', () => {
    const ev = buildReactionEvent('❤️', TARGET_1, PK_A);
    expect(ev.tags.find((t) => t[0] === 'k')).toBeUndefined();
  });
});

describe('buildReactionDeletionEvent', () => {
  it('produces a kind-5 with e + k=7 tags', () => {
    const del = buildReactionDeletionEvent('reaction-id-123');
    expect(del.kind).toBe(5);
    expect(del.content).toBe('');
    expect(del.tags).toEqual(
      expect.arrayContaining([
        ['e', 'reaction-id-123'],
        ['k', '7'],
      ]),
    );
  });
});

describe('parseReactionEvent', () => {
  it('extracts the e tag, pubkey, content, and createdAt', () => {
    const parsed = parseReactionEvent({
      id: 'r1',
      pubkey: PK_A,
      kind: 7,
      content: '🔥',
      created_at: 1000,
      tags: [
        ['p', PK_B],
        ['e', TARGET_1],
      ],
    });
    expect(parsed).toEqual({
      id: 'r1',
      reactorPubkey: PK_A,
      emoji: '🔥',
      createdAt: 1000,
      targetEventId: TARGET_1,
    });
  });

  it('returns null on a non-kind-7 event', () => {
    expect(
      parseReactionEvent({
        id: 'r1',
        pubkey: PK_A,
        kind: 1,
        content: '🔥',
        created_at: 1000,
        tags: [['e', TARGET_1]],
      }),
    ).toBeNull();
  });

  it('returns null when no e tag is present', () => {
    expect(
      parseReactionEvent({
        id: 'r1',
        pubkey: PK_A,
        kind: 7,
        content: '🔥',
        created_at: 1000,
        tags: [['p', PK_B]],
      }),
    ).toBeNull();
  });

  it('uses the LAST e tag per NIP-25 spec when multiple are present', () => {
    const parsed = parseReactionEvent({
      id: 'r1',
      pubkey: PK_A,
      kind: 7,
      content: '🔥',
      created_at: 1000,
      tags: [
        ['e', TARGET_1],
        ['e', TARGET_2],
      ],
    });
    expect(parsed?.targetEventId).toBe(TARGET_2);
  });

  it('coerces empty content to "+" so the renderer always has a glyph', () => {
    const parsed = parseReactionEvent({
      id: 'r1',
      pubkey: PK_A,
      kind: 7,
      content: '',
      created_at: 1000,
      tags: [['e', TARGET_1]],
    });
    expect(parsed?.emoji).toBe('+');
  });
});

describe('reduceReactions', () => {
  it('returns an empty map when given no records', () => {
    expect(reduceReactions([], PK_ME).size).toBe(0);
  });

  it('groups reactors by emoji per target', () => {
    const out = reduceReactions(
      [
        rec(PK_A, '🔥', TARGET_1, 100),
        rec(PK_B, '🔥', TARGET_1, 101),
        rec(PK_C, '❤️', TARGET_1, 102),
        rec(PK_A, '👍', TARGET_2, 103),
      ],
      PK_ME,
    );
    expect(out.get(TARGET_1)?.byEmoji['🔥']).toEqual([PK_A, PK_B]);
    expect(out.get(TARGET_1)?.byEmoji['❤️']).toEqual([PK_C]);
    expect(out.get(TARGET_2)?.byEmoji['👍']).toEqual([PK_A]);
  });

  it('dedupes the same (reactor, emoji, target) — latest wins', () => {
    // Same person reacted twice with the same emoji to the same message.
    // Out-of-order delivery shouldn't matter.
    const out = reduceReactions(
      [rec(PK_A, '🔥', TARGET_1, 200, 'newer'), rec(PK_A, '🔥', TARGET_1, 100, 'older')],
      PK_ME,
    );
    expect(out.get(TARGET_1)?.byEmoji['🔥']).toEqual([PK_A]);
  });

  it('orders reactors within an emoji bucket by createdAt ascending', () => {
    const out = reduceReactions(
      [
        rec(PK_C, '🔥', TARGET_1, 300),
        rec(PK_A, '🔥', TARGET_1, 100),
        rec(PK_B, '🔥', TARGET_1, 200),
      ],
      PK_ME,
    );
    expect(out.get(TARGET_1)?.byEmoji['🔥']).toEqual([PK_A, PK_B, PK_C]);
  });

  it("records the viewer's reaction id in myReactions for toggle support", () => {
    const out = reduceReactions(
      [rec(PK_A, '🔥', TARGET_1, 100), rec(PK_ME, '🔥', TARGET_1, 101, 'my-reaction-id')],
      PK_ME,
    );
    expect(out.get(TARGET_1)?.myReactions['🔥']).toBe('my-reaction-id');
  });

  it('matches the viewer pubkey case-insensitively', () => {
    const upper = PK_ME.toUpperCase();
    const out = reduceReactions([rec(PK_ME, '🔥', TARGET_1, 100, 'my-reaction-id')], upper);
    expect(out.get(TARGET_1)?.myReactions['🔥']).toBe('my-reaction-id');
  });

  it('leaves myReactions empty when no viewer pubkey is supplied', () => {
    const out = reduceReactions([rec(PK_A, '🔥', TARGET_1, 100)], null);
    expect(out.get(TARGET_1)?.myReactions).toEqual({});
  });

  it('keeps multiple distinct emojis from the same reactor', () => {
    const out = reduceReactions(
      [rec(PK_A, '🔥', TARGET_1, 100), rec(PK_A, '❤️', TARGET_1, 101)],
      PK_ME,
    );
    expect(out.get(TARGET_1)?.byEmoji['🔥']).toEqual([PK_A]);
    expect(out.get(TARGET_1)?.byEmoji['❤️']).toEqual([PK_A]);
  });
});

describe('applyReactionDeletion', () => {
  it('removes a record matching id + author', () => {
    const records = [rec(PK_A, '🔥', TARGET_1, 100, 'r1'), rec(PK_B, '🔥', TARGET_1, 101, 'r2')];
    const out = applyReactionDeletion(records, 'r1', PK_A);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('r2');
  });

  it('refuses to delete when the deletion was issued by a different pubkey (NIP-09)', () => {
    // NIP-09: only the original author can delete their own event.
    const records = [rec(PK_A, '🔥', TARGET_1, 100, 'r1')];
    const out = applyReactionDeletion(records, 'r1', PK_B);
    expect(out).toHaveLength(1);
  });

  it('is a no-op when the deletion targets an unknown id', () => {
    const records = [rec(PK_A, '🔥', TARGET_1, 100, 'r1')];
    expect(applyReactionDeletion(records, 'r-unknown', PK_A)).toEqual(records);
  });
});
