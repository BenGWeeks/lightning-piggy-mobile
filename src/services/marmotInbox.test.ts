import { marmotImetaTag } from './marmotMedia';
import { parseFileAttachment } from '../utils/fileAttachment';
import { parseVoiceNote } from '../utils/messageContent';
import {
  marmotRumorToDmRow,
  marmotRumorToGroupMessage,
  marmotTagMentions,
  storedKindForMarmot,
} from './marmotInbox';
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

  it('keeps an unknown group application kind even with an empty body', () => {
    expect(marmotRumorToGroupMessage(rumor({ kind: 1234, content: '' }))).toMatchObject({
      wireKind: 1234,
      text: '',
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

describe('marmotInbox — attachments', () => {
  const CT = 'ab'.repeat(32);
  const URL = `https://blossom.example/${CT}.bin`;
  const media = (mediaType: string, filename: string) => ({
    version: 'encrypted-media-v2' as const,
    locators: [],
    ciphertextSha256: CT,
    plaintextSha256: 'cd'.repeat(32),
    nonce: 'ef'.repeat(12),
    mediaType,
    filename,
  });
  const withTag = (mediaType: string, filename: string, content = '') =>
    rumor({ content, tags: [marmotImetaTag(media(mediaType, filename), URL)] } as never);
  const keys = { [CT]: { url: URL, keysHex: ['11'.repeat(32)] } };

  it('stores a White Noise voice note (audio/mp4 imeta) as a kind-15 voice row, in 1:1 and groups', () => {
    const r = withTag('audio/mp4', 'voice-2000ms.m4a');
    const row = marmotRumorToDmRow(ME, { group: dm, rumor: r, mediaKeys: keys })!;
    expect(row.wireKind).toBe(15);
    expect(parseVoiceNote(row.content)).toMatchObject({ url: URL, mime: 'audio/mp4' });
    expect(parseVoiceNote(marmotRumorToGroupMessage(r, keys).text)).not.toBeNull();
  });

  it('stores a PDF as a shareable file, or an unavailable file when keys are missing', () => {
    const r = withTag('application/pdf', 'doc.pdf');
    const row = marmotRumorToDmRow(ME, { group: dm, rumor: r, mediaKeys: keys })!;
    expect(row.wireKind).toBe(15);
    expect(parseFileAttachment(row.content)).toMatchObject({
      mime: 'application/pdf',
      available: true,
    });
    expect(parseFileAttachment(marmotRumorToGroupMessage(r).text)).toMatchObject({
      available: false,
    });
  });

  it('preserves plain imeta file metadata and never treats malformed encrypted files as plaintext', () => {
    const tags = [
      [
        'imeta',
        'url https://blossom.example/invoice.pdf',
        'm application/pdf',
        'name Invoice.pdf',
        'size 2048',
      ],
    ];
    const r = rumor({ content: '', tags } as never);
    const row = marmotRumorToDmRow(ME, { group: dm, rumor: r })!;
    expect(parseFileAttachment(row.content)).toMatchObject({
      name: 'Invoice.pdf',
      size: 2048,
      encrypted: false,
      available: true,
    });
    expect(marmotRumorToGroupMessage(r).wireKind).toBe(15);
    const bad = rumor({ content: '', tags: [[...tags[0], 'v encrypted-media-v2']] } as never);
    expect(parseFileAttachment(marmotRumorToGroupMessage(bad).text)).toMatchObject({
      available: false,
    });
  });

  it('keeps a real caption over the fallback', () => {
    const r = withTag('application/pdf', 'doc.pdf', 'see attached');
    expect(
      parseFileAttachment(marmotRumorToDmRow(ME, { group: dm, rumor: r })!.content),
    ).toMatchObject({ caption: 'see attached', available: false });
  });
});

describe('marmotInbox replies', () => {
  const PARENT = 'c'.repeat(64);
  const reply = rumor({}) && {
    ...rumor(),
    tags: [
      ['e', PARENT],
      ['q', PARENT],
    ],
  };
  it('carries the quoted parent onto the DM row and the group message', () => {
    expect(marmotRumorToDmRow(ME, { group: dm, rumor: reply })).toMatchObject({ replyTo: PARENT });
    expect(marmotRumorToGroupMessage(reply)).toMatchObject({ replyTo: PARENT });
  });
  it('leaves replyTo off a plain message', () => {
    expect(marmotRumorToDmRow(ME, { group: dm, rumor: rumor() })).not.toHaveProperty('replyTo');
    expect(marmotRumorToGroupMessage(rumor())).not.toHaveProperty('replyTo');
  });
});

describe('marmotTagMentions (#1295)', () => {
  const ALICE = 'c'.repeat(64);
  const tagged = (tags: string[][]) => ({ ...rumor(), tags });

  it('reads p tags on a Marmot chat message as mentions', () => {
    expect(
      marmotTagMentions(
        tagged([
          ['p', ALICE.toUpperCase()],
          ['p', ALICE],
        ]),
      ),
    ).toEqual([ALICE]);
    expect(marmotRumorToGroupMessage(tagged([['p', ALICE]]))).toMatchObject({ mentions: [ALICE] });
  });

  it('ignores the roster p tags of an older NIP-17-shaped rumor (has a subject)', () => {
    expect(
      marmotTagMentions(
        tagged([
          ['subject', 'Pigs'],
          ['p', ALICE],
        ]),
      ),
    ).toEqual([]);
    expect(
      marmotRumorToGroupMessage(
        tagged([
          ['subject', 'Pigs'],
          ['p', ALICE],
        ]),
      ),
    ).not.toHaveProperty('mentions');
  });

  it('ignores malformed p tags and non-chat kinds', () => {
    expect(
      marmotTagMentions(
        tagged([
          ['p', 'nope'],
          ['e', ALICE],
        ]),
      ),
    ).toEqual([]);
    expect(marmotTagMentions({ ...tagged([['p', ALICE]]), kind: 7 })).toEqual([]);
  });
});
