/**
 * Property tests for the synthetic-room key derivation. Two peers
 * decoding the same NIP-17 kind-14 rumor MUST land on the same
 * synthetic groupId — otherwise foreign-client messages would
 * thread differently on each peer device. Issue #271.
 */

import { isSyntheticGroupId, syntheticGroupIdForParticipants } from './syntheticGroupId';
import { createGroupChatRumor } from '../services/nostrService';
import { participantsFromRumor, type DecodedRumor } from './nip17Unwrap';

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);
const PK_C = 'c'.repeat(64);

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
