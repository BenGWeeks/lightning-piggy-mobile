import {
  buildAdminUpdate,
  canRemoveAdmin,
  isGroupAdmin,
  LastAdminError,
  normaliseAdmins,
} from './groupAdmins';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

describe('groupAdmins', () => {
  it('matches admins case-insensitively', () => {
    expect(isGroupAdmin([A.toUpperCase()], A)).toBe(true);
    expect(isGroupAdmin([A], B)).toBe(false);
    expect(isGroupAdmin(undefined, A)).toBe(false);
  });

  it('normalises to lower-case without duplicates', () => {
    expect(normaliseAdmins([A, A.toUpperCase(), B])).toEqual([A, B]);
  });

  describe('last-admin guard', () => {
    it('refuses to remove the only admin', () => {
      expect(canRemoveAdmin([A], A)).toBe(false);
      expect(canRemoveAdmin([A, A.toUpperCase()], A)).toBe(false);
      expect(() => buildAdminUpdate([A], A, 'remove')).toThrow(LastAdminError);
    });

    it('allows removing an admin (yourself included) when another remains', () => {
      expect(canRemoveAdmin([A, B], A)).toBe(true);
      expect(buildAdminUpdate([A, B], A, 'remove')).toEqual([B]);
    });

    it('never offers removal for someone who is not an admin', () => {
      expect(canRemoveAdmin([A, B], C)).toBe(false);
      expect(canRemoveAdmin(undefined, A)).toBe(false);
    });
  });

  describe('buildAdminUpdate', () => {
    it('adds a new admin once', () => {
      expect(buildAdminUpdate([A], B, 'add')).toEqual([A, B]);
      expect(buildAdminUpdate([A, B], B.toUpperCase(), 'add')).toEqual([A, B]);
    });

    it('removes case-insensitively and leaves others in place', () => {
      expect(buildAdminUpdate([A, B, C], B.toUpperCase(), 'remove')).toEqual([A, C]);
    });
  });
});
