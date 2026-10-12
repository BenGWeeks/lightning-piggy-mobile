import { buildFollowedSet, canAutoLoadMedia } from './mediaTrust';

const FRIEND = 'a'.repeat(64);
const STRANGER = 'b'.repeat(64);

describe('mediaTrust', () => {
  const followed = buildFollowedSet([{ pubkey: FRIEND.toUpperCase() }, { pubkey: '' }]);

  it('normalises followed pubkeys to lower case and skips blanks', () => {
    expect([...followed]).toEqual([FRIEND]);
  });

  it('always auto-loads my own messages', () => {
    expect(canAutoLoadMedia(true, STRANGER, followed)).toBe(true);
    expect(canAutoLoadMedia(true, null, new Set())).toBe(true);
  });

  it('auto-loads messages from people I follow (case-insensitive)', () => {
    expect(canAutoLoadMedia(false, FRIEND, followed)).toBe(true);
    expect(canAutoLoadMedia(false, FRIEND.toUpperCase(), followed)).toBe(true);
  });

  it('gates messages from people I do not follow', () => {
    expect(canAutoLoadMedia(false, STRANGER, followed)).toBe(false);
  });

  it('fails closed for an unknown sender or an empty follow list', () => {
    expect(canAutoLoadMedia(false, null, followed)).toBe(false);
    expect(canAutoLoadMedia(false, undefined, followed)).toBe(false);
    expect(canAutoLoadMedia(false, '', followed)).toBe(false);
    expect(canAutoLoadMedia(false, FRIEND, new Set())).toBe(false);
  });

  it('decides per sender within a group', () => {
    const groupMessages = [
      { from: FRIEND, fromMe: false },
      { from: STRANGER, fromMe: false },
      { from: STRANGER, fromMe: true },
    ];
    expect(groupMessages.map((m) => canAutoLoadMedia(m.fromMe, m.from, followed))).toEqual([
      true,
      false,
      true,
    ]);
  });
});
