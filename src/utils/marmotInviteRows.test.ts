import {
  FAILED_INVITE_ENTRY_PREFIX,
  failedInvitesFrom,
  withMarmotInviteRows,
} from './marmotInviteRows';
import { buildConversationItems, type ConversationMessageInput } from './conversationItems';
import { buildDmSummaries, type DmInboxEntry } from './conversationSummaries';
import type { FailedMarmotInvite } from '../services/marmotWelcomeOutcomes';

jest.mock('../services/boltzService', () => ({
  isBitcoinAddress: () => false,
}));

const MAX = 'b'.repeat(64);
const PREVIEW = '🔒 couldn’t be opened';
const AMY = 'c'.repeat(64);

const entry = (over: Partial<DmInboxEntry>): DmInboxEntry => ({
  id: 'w',
  partnerPubkey: MAX,
  fromMe: false,
  createdAt: 100,
  text: 'hi',
  wireKind: 14,
  ...over,
});
const failed = (over: Partial<FailedMarmotInvite> = {}): FailedMarmotInvite => ({
  id: 'welcome1',
  sender: MAX,
  createdAt: 300,
  reason: 'noKey',
  ...over,
});

describe('withMarmotInviteRows (Messages list)', () => {
  it('returns the same array when there are no invites', () => {
    const entries = [entry({})];
    expect(withMarmotInviteRows(entries, [], PREVIEW)).toBe(entries);
  });

  it('hides joined / pending invites: a thread of only invites disappears', () => {
    const entries = [entry({ id: 'invite', wireKind: 444, createdAt: 500 })];
    expect(withMarmotInviteRows(entries, [], PREVIEW)).toEqual([]);
    expect(buildDmSummaries(withMarmotInviteRows(entries, [], PREVIEW), [])).toEqual([]);
  });

  it('keeps the real latest message when an invite was newer', () => {
    const entries = [
      entry({ id: 'text', createdAt: 100, text: 'hello' }),
      entry({ id: 'invite', wireKind: 444, createdAt: 500 }),
    ];
    const [row] = buildDmSummaries(withMarmotInviteRows(entries, [], PREVIEW), []);
    expect(row).toMatchObject({ lastComment: 'hello', lastActivityAt: 100 });
    expect(row.marmotInviteFailed).toBeUndefined();
  });

  it('shows a failed invite as an explanatory row in the sender’s NIP-17 thread', () => {
    const entries = [entry({ id: 'invite', wireKind: 444, createdAt: 300 })];
    const out = withMarmotInviteRows(entries, [failed()], PREVIEW);
    expect(out).toEqual([
      expect.objectContaining({
        id: `${FAILED_INVITE_ENTRY_PREFIX}welcome1`,
        partnerPubkey: MAX,
        createdAt: 300,
        wireKind: 444,
      }),
    ]);
    const [row] = buildDmSummaries(out, []);
    expect(row).toMatchObject({ id: `${MAX}:nip17`, marmotInviteFailed: true });
    expect(row.lastComment).toBe(PREVIEW);
  });
});

describe('thread rows', () => {
  const msg = (over: Partial<ConversationMessageInput>): ConversationMessageInput => ({
    id: 'm',
    fromMe: false,
    text: 'hi',
    createdAt: 100,
    ...over,
  });

  it('failedInvitesFrom picks the partner’s failed invites', () => {
    const amy = failed({ id: 'amy', sender: AMY, createdAt: 9 });
    expect(failedInvitesFrom([failed(), amy], MAX.toUpperCase())).toEqual([failed()]);
  });

  it('buildConversationItems hides every invite row and draws failed ones from the record', () => {
    // Two invites in the same second: one joined, one failed — no mix-up.
    const messages = [
      msg({ id: 'text', text: 'hello', createdAt: 100, wireKind: 14 }),
      msg({ id: 'joined', wireKind: 444, createdAt: 300 }),
      msg({ id: 'failedWrap', wireKind: 444, createdAt: 300 }),
      msg({ id: 'mine', wireKind: 444, createdAt: 50, fromMe: true }),
    ];
    const kinds = (items: ReturnType<typeof buildConversationItems>) =>
      items.filter((i) => i.kind !== 'dayHeader').map((i) => [i.kind, i.id]);
    expect(kinds(buildConversationItems(messages, [], undefined, [failed()]))).toEqual([
      ['marmotInviteFailed', 'invite-welcome1'],
      ['message', 'dm-text'],
    ]);
    // Nothing failed (all joined or still pending): no invite rows at all.
    expect(kinds(buildConversationItems(messages, []))).toEqual([['message', 'dm-text']]);
  });
});
