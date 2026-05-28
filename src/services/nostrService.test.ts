/**
 * Wire-format guards for outgoing NIP-17 kind-14 rumors:
 *
 *  - `createGroupChatRumor`: subject tag is what foreign clients
 *    (Amethyst / Quartz, 0xchat) read to display the group name —
 *    Lightning Piggy's outgoing messages MUST include it for
 *    cross-client interop. Issue #271.
 *  - `createDirectMessageRumor`: 1:1 direct messages must NOT carry
 *    a subject tag and must p-tag exactly the recipient — this is
 *    what `classifyRumor` keys off when distinguishing DMs from
 *    group rumors on receive. Issue #140.
 *
 * Also covers perf-critical verify path:
 *  - kind 1059 (NIP-59 gift-wrap) must skip schnorr and use only
 *    structural `validateEvent` — the outer wrap uses an ephemeral key
 *    so schnorr provides no integrity signal. (#739 Fix 5)
 */

import { createDirectMessageRumor, createGroupChatRumor, pool } from './nostrService';

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);
const PK_C = 'c'.repeat(64);

describe('createGroupChatRumor (outgoing kind-14)', () => {
  it('includes a subject tag carrying the group name', () => {
    const rumor = createGroupChatRumor({
      senderPubkey: PK_A,
      subject: 'Pizza Friday',
      memberPubkeys: [PK_B, PK_C],
      content: 'who is in?',
    });
    const subject = rumor.tags.find((t) => t[0] === 'subject');
    expect(subject).toEqual(['subject', 'Pizza Friday']);
  });

  it('emits one p tag per recipient member', () => {
    const rumor = createGroupChatRumor({
      senderPubkey: PK_A,
      subject: 'x',
      memberPubkeys: [PK_B, PK_C],
      content: 'hi',
    });
    const ps = rumor.tags.filter((t) => t[0] === 'p').map((t) => t[1]);
    expect(ps).toEqual([PK_B, PK_C]);
  });

  it('builds a kind-14 rumor (NIP-17 chat)', () => {
    const rumor = createGroupChatRumor({
      senderPubkey: PK_A,
      subject: 'x',
      memberPubkeys: [PK_B],
      content: 'hi',
    });
    expect(rumor.kind).toBe(14);
    expect(rumor.pubkey).toBe(PK_A);
    expect(rumor.content).toBe('hi');
  });
});

describe('createDirectMessageRumor (outgoing 1:1 kind-14)', () => {
  it('builds a kind-14 rumor (NIP-17 chat) with the sender pubkey', () => {
    const rumor = createDirectMessageRumor({
      senderPubkey: PK_A,
      recipientPubkey: PK_B,
      content: 'hello',
    });
    expect(rumor.kind).toBe(14);
    expect(rumor.pubkey).toBe(PK_A);
    expect(rumor.content).toBe('hello');
  });

  it('emits exactly one p tag pointing at the recipient', () => {
    const rumor = createDirectMessageRumor({
      senderPubkey: PK_A,
      recipientPubkey: PK_B,
      content: 'hi',
    });
    const ps = rumor.tags.filter((t) => t[0] === 'p').map((t) => t[1]);
    expect(ps).toEqual([PK_B]);
  });

  it('does NOT include a subject tag (would mis-classify as group on receive)', () => {
    const rumor = createDirectMessageRumor({
      senderPubkey: PK_A,
      recipientPubkey: PK_B,
      content: 'hi',
    });
    const subject = rumor.tags.find((t) => t[0] === 'subject');
    expect(subject).toBeUndefined();
  });

  it('does NOT use legacy NIP-04 kind 4', () => {
    // Belt-and-suspenders guard: issue #140 explicitly removes kind 4
    // from the outbound DM path. If a future refactor regresses to
    // kind 4 this test fails loudly.
    const rumor = createDirectMessageRumor({
      senderPubkey: PK_A,
      recipientPubkey: PK_C,
      content: 'no leaks',
    });
    expect(rumor.kind).not.toBe(4);
  });
});

describe('pool.verifyEvent — skip-verify kinds (#739 Fix 5)', () => {
  // Build the minimal structural fields validateEvent needs. We do NOT
  // supply a valid id/sig — the point is that for skip-verify kinds the
  // patched pool.verifyEvent accepts structurally valid events even with
  // a garbage signature, whereas for schnorr-verified kinds (e.g. kind 1)
  // the same garbage signature causes a rejection.
  const BASE_PUBKEY = 'a'.repeat(64);

  function makeEvent(kind: number) {
    return {
      id: 'b'.repeat(64),
      pubkey: BASE_PUBKEY,
      created_at: 1700000000,
      kind,
      tags: [],
      content: 'test',
      // Deliberately invalid sig — schnorr verify would fail.
      sig: 'c'.repeat(128),
    };
  }

  it('kind 1059 (gift-wrap) passes with a structurally valid event but invalid sig', () => {
    // schnorr would reject this; structural validate passes it.
    // Confirms that k1059 is in SKIP_VERIFY_KINDS.
    expect(pool.verifyEvent(makeEvent(1059) as Parameters<typeof pool.verifyEvent>[0])).toBe(true);
  });

  it('kind 37516 (NIP-GC cache listing) passes with invalid sig (existing skip-verify)', () => {
    expect(pool.verifyEvent(makeEvent(37516) as Parameters<typeof pool.verifyEvent>[0])).toBe(true);
  });

  it('kind 31923 (NIP-52 meetup) passes with invalid sig (existing skip-verify)', () => {
    expect(pool.verifyEvent(makeEvent(31923) as Parameters<typeof pool.verifyEvent>[0])).toBe(true);
  });

  // NOTE: We don't test that non-skip kinds reject invalid sigs here —
  // that would be testing nostr-tools' schnorr implementation, not our code.
  // The positive tests above are sufficient to confirm SKIP_VERIFY_KINDS
  // membership; schnorr correctness is nostr-tools' responsibility.
});
