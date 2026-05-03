/**
 * Wire-format guards for NIP-17 group interop with foreign clients
 * (Amethyst / Quartz, 0xchat). See issue #271 for context. The tests
 * here exist specifically because Amethyst + 0xchat key the room off
 * (sender + p tags) and read the conversation name from the kind-14
 * `subject` tag — Lightning Piggy's outgoing messages MUST include
 * `subject`, and our incoming routing MUST be able to materialise a
 * room from the participant set.
 */

import { createGroupChatRumor } from '../../src/services/nostrService';
import {
  participantsFromRumor,
  subjectFromRumor,
  type DecodedRumor,
} from '../../src/utils/nip17Unwrap';
import {
  isSyntheticGroupId,
  syntheticGroupIdForParticipants,
} from '../../src/utils/syntheticGroupId';

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

describe('subjectFromRumor (incoming kind-14)', () => {
  function rumorWithTags(tags: string[][]): DecodedRumor {
    return {
      pubkey: PK_A,
      created_at: 1,
      kind: 14,
      tags,
      content: '',
    };
  }

  it('returns the subject value when present', () => {
    expect(subjectFromRumor(rumorWithTags([['subject', 'Hello']]))).toBe('Hello');
  });

  it('returns null when there is no subject tag', () => {
    expect(subjectFromRumor(rumorWithTags([['p', PK_B]]))).toBeNull();
  });

  it('returns null when subject is whitespace-only', () => {
    expect(subjectFromRumor(rumorWithTags([['subject', '   ']]))).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(subjectFromRumor(rumorWithTags([['subject', '  Pizza Friday  ']]))).toBe('Pizza Friday');
  });
});

describe('syntheticGroupIdForParticipants (NIP-17 room key)', () => {
  it('is order-independent', () => {
    const a = syntheticGroupIdForParticipants([PK_A, PK_B, PK_C]);
    const b = syntheticGroupIdForParticipants([PK_C, PK_A, PK_B]);
    expect(a).toBe(b);
  });

  it('is case-insensitive', () => {
    const lower = syntheticGroupIdForParticipants([PK_A, PK_B]);
    const mixed = syntheticGroupIdForParticipants([PK_A.toUpperCase(), PK_B]);
    expect(lower).toBe(mixed);
  });

  it('deduplicates inputs', () => {
    const once = syntheticGroupIdForParticipants([PK_A, PK_B]);
    const twice = syntheticGroupIdForParticipants([PK_A, PK_B, PK_A]);
    expect(once).toBe(twice);
  });

  it('changes when membership changes (new room per spec)', () => {
    const ab = syntheticGroupIdForParticipants([PK_A, PK_B]);
    const abc = syntheticGroupIdForParticipants([PK_A, PK_B, PK_C]);
    expect(ab).not.toBe(abc);
  });

  it('uses the s_ prefix so synthetic ids are distinguishable', () => {
    const id = syntheticGroupIdForParticipants([PK_A, PK_B]);
    expect(id.startsWith('s_')).toBe(true);
    expect(isSyntheticGroupId(id)).toBe(true);
    expect(isSyntheticGroupId('g_native')).toBe(false);
  });

  it('matches the participant set extracted from a roundtripped rumor', () => {
    // Wire-format property: a sender's outgoing rumor + viewer's
    // computed room key (sender + p tags) MUST produce the same
    // synthetic id on every peer device. Otherwise the same foreign-
    // client message would land in different threads on different
    // peers.
    const rumor = createGroupChatRumor({
      senderPubkey: PK_A,
      subject: 'x',
      memberPubkeys: [PK_B, PK_C],
      content: 'hi',
    });
    const roomKey = participantsFromRumor(rumor as DecodedRumor);
    const senderId = syntheticGroupIdForParticipants(roomKey);
    // A peer recomputing from (sender + their own pubkey + every other
    // p tag) lands on the same id.
    const peerView = new Set([PK_A, PK_B, PK_C]);
    expect(senderId).toBe(syntheticGroupIdForParticipants(peerView));
  });
});
