import { marmotReplyTags, marmotReplyParent } from '../services/marmotEdits';
import { buildMarmotRumor } from '../services/marmotSession';
import * as nip19 from 'nostr-tools/nip19';
import { marmotGroupDraft } from './useGroupMessaging';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

describe('marmotGroupDraft (#1295)', () => {
  const rumor = (content: string) => ({
    kind: 14,
    pubkey: 'c'.repeat(64),
    created_at: 1,
    content,
    tags: [
      ['subject', 'Pigs'],
      ['p', ALICE],
      ['p', BOB],
      ['q', 'd'.repeat(64)],
    ],
  });

  it('drops the NIP-17 roster p tags and subject, keeping other tags', () => {
    expect(marmotGroupDraft(rumor('hello')).tags).toEqual([['q', 'd'.repeat(64)]]);
  });

  it('p-tags each member the text mentions', () => {
    const text = `hi nostr:${nip19.npubEncode(BOB)} and nostr:${nip19.npubEncode(BOB)}`;
    const draft = marmotGroupDraft(rumor(text));
    expect(draft.tags).toEqual([
      ['q', 'd'.repeat(64)],
      ['p', BOB],
    ]);
    expect(draft.content).toBe(text);
  });
});

it('encodes a group reply with both MDK tags and parses it after kind conversion', () => {
  const parent = 'D'.repeat(64);
  const draft = marmotGroupDraft({
    kind: 14,
    content: 'reply',
    tags: [['subject', 'Pigs'], ['p', BOB], ...marmotReplyTags(parent)],
  });
  expect(draft.tags).toEqual([
    ['e', parent.toLowerCase()],
    ['q', parent.toLowerCase()],
  ]);
  expect(marmotReplyParent(buildMarmotRumor(ALICE, { ...draft, kind: 9 }))).toBe(
    parent.toLowerCase(),
  );
  expect(marmotReplyTags('local_pending')).toEqual([]);
});
