import { marmotRumorToDmRow, marmotRumorToGroupMessage, storedKindForMarmot } from './marmotInbox';
import type { MarmotGroupSummary } from './marmotSession';

const ME = 'a'.repeat(64);
const PEER = 'b'.repeat(64);
const dm: MarmotGroupSummary = {
  id: 'marmot:1', name: '', description: '', memberPubkeys: [PEER],
  adminPubkeys: [], isDm: true, relays: [], createdAt: 0,
}; // prettier-ignore
const rumor = (over: Partial<{ pubkey: string; kind: number; content: string }> = {}) => ({
  id: 'r'.repeat(64),
  pubkey: PEER,
  created_at: 100,
  kind: 9,
  tags: [],
  content: 'oink',
  ...over,
});

describe('marmotInbox', () => {
  it('maps Marmot chat (kind 9) to an app text row in the peer’s marmot thread', () => {
    expect(marmotRumorToDmRow(ME, { group: dm, rumor: rumor() })).toEqual({
      owner: ME,
      eventId: 'r'.repeat(64),
      conversation: PEER,
      createdAt: 100,
      sender: PEER,
      content: 'oink',
      fromMe: false,
      wireKind: 14,
      rumorId: 'r'.repeat(64),
      protocol: 'marmot',
    });
  });

  it('marks our own (other-device) messages fromMe and keeps non-chat kinds', () => {
    const row = marmotRumorToDmRow(ME, { group: dm, rumor: rumor({ pubkey: ME, kind: 1068 }) });
    expect(row).toMatchObject({ fromMe: true, sender: ME, wireKind: 1068 });
    expect(storedKindForMarmot(15)).toBe(15);
  });

  it('never stores protocol plumbing (push tokens, reactions, edits…) as a message', () => {
    // Amethyst / White Noise send MIP-05 push-token lists (kind 448, JSON
    // content) into every group — they surfaced as "Unsupported (kind 448)"
    // bubbles with a raw-JSON inbox preview.
    for (const kind of [448, 447, 449, 7, 5, 1009, 1210]) {
      expect(
        marmotRumorToDmRow(ME, { group: dm, rumor: rumor({ kind, content: '{"t":1}' }) }),
      ).toBeNull();
    }
  });

  it('ignores multi-member groups and DMs whose peer has not joined yet', () => {
    const group = { ...dm, isDm: false, memberPubkeys: [PEER, 'c'.repeat(64)] };
    expect(marmotRumorToDmRow(ME, { group, rumor: rumor() })).toBeNull();
    expect(
      marmotRumorToDmRow(ME, { group: { ...dm, memberPubkeys: [] }, rumor: rumor() }),
    ).toBeNull();
  });

  it('shapes group messages with a lowercased sender', () => {
    expect(marmotRumorToGroupMessage(rumor({ pubkey: PEER.toUpperCase() }))).toEqual({
      id: 'r'.repeat(64),
      senderPubkey: PEER,
      text: 'oink',
      createdAt: 100,
    });
  });
});
