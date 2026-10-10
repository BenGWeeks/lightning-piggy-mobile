import { DeletionLedger, mayDelete, parseMarmotDeletion } from './marmotDeletions';
import type { MarmotRumor } from './marmotSession';

const ME = 'a'.repeat(64);
const PEER = 'b'.repeat(64);
const ADMIN = 'c'.repeat(64);
const MSG = 'd'.repeat(64);
const DM = { isDm: true, adminPubkeys: [ME, PEER] };
const GROUP = { isDm: false, adminPubkeys: [ADMIN] };

const rumor = (over: Partial<MarmotRumor>): MarmotRumor => ({
  id: 'x'.repeat(64),
  pubkey: PEER,
  created_at: 100,
  kind: 5,
  tags: [['e', MSG]],
  content: '',
  ...over,
});

describe('parseMarmotDeletion', () => {
  it("reads White Noise's kind-5 (empty content, one e tag)", () => {
    expect(parseMarmotDeletion(rumor({}), DM)).toEqual({
      targets: [MSG],
      deleter: PEER,
      anyAuthor: false,
    });
  });

  it('lowercases ids and the deleter, ignores malformed ids', () => {
    const d = parseMarmotDeletion(
      rumor({
        pubkey: PEER.toUpperCase(),
        tags: [
          ['e', MSG.toUpperCase()],
          ['e', 'nothex'],
          ['p', ME],
        ],
      }),
      DM,
    );
    expect(d).toEqual({ targets: [MSG], deleter: PEER, anyAuthor: false });
  });

  it('is null for non-deletions and deletions without a valid target', () => {
    expect(parseMarmotDeletion(rumor({ kind: 9 }), DM)).toBeNull();
    expect(parseMarmotDeletion(rumor({ tags: [] }), DM)).toBeNull();
    expect(parseMarmotDeletion(rumor({ tags: [['e', 'short']] }), DM)).toBeNull();
  });

  describe('admin removal (kind 4891)', () => {
    const remove = (over: Partial<MarmotRumor> = {}) =>
      rumor({ kind: 4891, pubkey: ADMIN, content: '{"v":1,"action":"remove"}', ...over });

    it('is honoured from a group admin, whoever wrote the target', () => {
      expect(parseMarmotDeletion(remove(), GROUP)).toEqual({
        targets: [MSG],
        deleter: ADMIN,
        anyAuthor: true,
      });
    });
    it('from a non-admin only counts as the author deleting their own message', () => {
      expect(parseMarmotDeletion(remove({ pubkey: PEER }), GROUP)).toEqual({
        targets: [MSG],
        deleter: PEER,
        anyAuthor: false,
      });
    });
    it('is how White Noise deletes in a 1:1 chat (both members are admins)', () => {
      expect(parseMarmotDeletion(remove({ pubkey: PEER }), DM)).toMatchObject({
        deleter: PEER,
        anyAuthor: true,
      });
    });
    it('is ignored with a wrong payload', () => {
      expect(parseMarmotDeletion(remove({ content: '{"v":1,"action":"ban"}' }), GROUP)).toBeNull();
      expect(parseMarmotDeletion(remove({ content: '{"v":1}' }), GROUP)).toBeNull();
      expect(parseMarmotDeletion(remove({ content: 'nope' }), GROUP)).toBeNull();
    });
  });
});

describe('mayDelete', () => {
  it('lets only the original sender delete, unless it is an admin removal', () => {
    const own = { targets: [MSG], deleter: PEER, anyAuthor: false };
    expect(mayDelete(own, PEER.toUpperCase())).toBe(true);
    expect(mayDelete(own, ME)).toBe(false);
    expect(mayDelete({ ...own, deleter: ADMIN, anyAuthor: true }, ME)).toBe(true);
  });
});

describe('DeletionLedger', () => {
  const deletion = { targets: [MSG], deleter: PEER, anyAuthor: false };

  it('blocks a later arrival of the deleted message, from its author only', () => {
    const ledger = new DeletionLedger();
    ledger.add(deletion, 'g1');
    expect(ledger.blocks(MSG, PEER, 'g1')).toBe(true);
    expect(ledger.blocks(MSG.toUpperCase(), PEER, 'g1')).toBe(true);
    // A forged "delete" of someone else's message does nothing.
    expect(ledger.blocks(MSG, ME, 'g1')).toBe(false);
    expect(ledger.blocks('e'.repeat(64), PEER, 'g1')).toBe(false);
  });

  it('is scoped to the group the deletion was sent into', () => {
    const ledger = new DeletionLedger();
    ledger.add({ ...deletion, deleter: ADMIN, anyAuthor: true }, 'g1');
    expect(ledger.blocks(MSG, ME, 'g1')).toBe(true);
    expect(ledger.blocks(MSG, ME, 'g2')).toBe(false);
  });

  it('stays bounded, dropping the oldest', () => {
    const ledger = new DeletionLedger();
    const id = (n: number) => n.toString(16).padStart(64, '0');
    for (let i = 0; i < 2100; i++) ledger.add({ ...deletion, targets: [id(i)] }, 'g1');
    expect(ledger.blocks(id(0), PEER, 'g1')).toBe(false);
    expect(ledger.blocks(id(2099), PEER, 'g1')).toBe(true);
  });
});

it('accumulates different authors and never revokes admin authority', () => {
  const ledger = new DeletionLedger();
  ledger.add({ targets: [MSG], deleter: PEER, anyAuthor: false }, 'g');
  ledger.add({ targets: [MSG], deleter: ME, anyAuthor: false }, 'g');
  expect(ledger.blocks(MSG, PEER, 'g')).toBe(true);
  expect(ledger.blocks(MSG, ADMIN, 'g')).toBe(false);
  ledger.add({ targets: [MSG], deleter: ADMIN, anyAuthor: true }, 'g');
  ledger.add({ targets: [MSG], deleter: ME, anyAuthor: false }, 'g');
  expect(ledger.blocks(MSG, 'another-author', 'g')).toBe(true);
});
