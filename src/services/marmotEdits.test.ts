import { EditLedger, isNewerEdit, marmotReplyParent, parseMarmotEdit } from './marmotEdits';
import type { MarmotRumor } from './marmotSession';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const MSG = 'd'.repeat(64);

const rumor = (over: Partial<MarmotRumor>): MarmotRumor => ({
  id: 'x'.repeat(64),
  pubkey: B,
  created_at: 100,
  kind: 1009,
  tags: [['e', MSG]],
  content: 'v2',
  ...over,
});

describe('parseMarmotEdit', () => {
  it("reads White Noise's kind-1009 (one e tag, replacement text)", () => {
    expect(parseMarmotEdit(rumor({}))).toEqual({
      target: MSG,
      content: 'v2',
      editor: B,
      editedAt: 100,
      editId: 'x'.repeat(64),
    });
  });
  it('lowercases ids and ignores mention tags', () => {
    const edit = parseMarmotEdit(
      rumor({
        pubkey: B.toUpperCase(),
        tags: [
          ['e', MSG.toUpperCase()],
          ['p', A],
        ],
      }),
    );
    expect(edit).toMatchObject({ target: MSG, editor: B });
  });
  it('is null for other kinds, bad targets and empty replacements', () => {
    expect(parseMarmotEdit(rumor({ kind: 9 }))).toBeNull();
    expect(parseMarmotEdit(rumor({ tags: [] }))).toBeNull();
    expect(parseMarmotEdit(rumor({ tags: [['e', 'zz']] }))).toBeNull();
    expect(parseMarmotEdit(rumor({ content: '  ' }))).toBeNull();
  });
});

describe('marmotReplyParent', () => {
  const reply = (tags: string[][], kind = 9) => rumor({ kind, tags, content: 'sure' });
  it('reads the q tag White Noise sets (with the matching e tag)', () => {
    expect(
      marmotReplyParent(
        reply([
          ['e', MSG],
          ['q', MSG],
        ]),
      ),
    ).toBe(MSG);
  });
  it('falls back to the e tag, prefers q when they differ', () => {
    expect(marmotReplyParent(reply([['e', MSG]]))).toBe(MSG);
    expect(
      marmotReplyParent(
        reply([
          ['e', A],
          ['q', MSG],
        ]),
      ),
    ).toBe(MSG);
  });
  it('is undefined for a plain message, malformed ids and non-chat kinds', () => {
    expect(marmotReplyParent(reply([]))).toBeUndefined();
    expect(marmotReplyParent(reply([['q', 'nope']]))).toBeUndefined();
    expect(marmotReplyParent(reply([['e', MSG]], 7))).toBeUndefined();
  });
});

describe('EditLedger', () => {
  const edit = (editor: string, editedAt: number, content: string, editId = 'a'.repeat(64)) => ({
    target: MSG,
    content,
    editor,
    editedAt,
    editId,
  });

  it('breaks a created_at tie by the higher edit id, whatever the arrival order', () => {
    for (const order of [
      ['v2', 'v3'],
      ['v3', 'v2'],
    ]) {
      const ledger = new EditLedger();
      const ids: Record<string, string> = { v2: '1'.repeat(64), v3: '2'.repeat(64) };
      for (const v of order) ledger.add(edit(A, 100, v, ids[v]), 'g1');
      expect(ledger.latestFor(MSG, A, 'g1')?.content).toBe('v3');
    }
  });

  it('keeps the latest edit by the author, whatever the arrival order', () => {
    const ledger = new EditLedger();
    ledger.add(edit(A, 200, 'v3'), 'g1');
    ledger.add(edit(A, 100, 'v2'), 'g1');
    expect(ledger.latestFor(MSG, A, 'g1')).toMatchObject({ content: 'v3', editedAt: 200 });
  });
  it('never returns an edit by someone other than the asked author', () => {
    const ledger = new EditLedger();
    ledger.add(edit(A, 100, 'mine'), 'g1');
    ledger.add(edit(B, 999, 'forged'), 'g1');
    expect(ledger.latestFor(MSG, A, 'g1')?.content).toBe('mine');
    expect(ledger.latestFor(MSG, B.toUpperCase(), 'g1')?.content).toBe('forged');
  });
  it('is scoped to the group', () => {
    const ledger = new EditLedger();
    ledger.add(edit(A, 100, 'v2'), 'g1');
    expect(ledger.latestFor(MSG, A, 'g2')).toBeUndefined();
  });
});

describe('isNewerEdit', () => {
  it('orders by created_at, then the higher edit id; anything beats no edit', () => {
    expect(isNewerEdit({ editedAt: 2, editId: 'a' }, { editedAt: 1, editId: 'z' })).toBe(true);
    expect(isNewerEdit({ editedAt: 1, editId: 'z' }, { editedAt: 2, editId: 'a' })).toBe(false);
    expect(isNewerEdit({ editedAt: 1, editId: 'b' }, { editedAt: 1, editId: 'a' })).toBe(true);
    expect(isNewerEdit({ editedAt: 1, editId: 'a' }, { editedAt: 1, editId: 'a' })).toBe(false);
    expect(isNewerEdit({ editedAt: 1, editId: 'a' }, {})).toBe(true);
  });
});
