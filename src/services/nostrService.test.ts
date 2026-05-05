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
 */

import { createDirectMessageRumor, createGroupChatRumor } from './nostrService';

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
