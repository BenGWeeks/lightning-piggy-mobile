import {
  buildAdminUpdate,
  canManageGroup,
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

describe('canManageGroup', () => {
  const me = 'ab'.repeat(32);
  const other = 'cd'.repeat(32);

  it('lets anyone manage a NIP-17 group', () => {
    expect(canManageGroup({}, me)).toBe(true);
    expect(canManageGroup({ adminPubkeys: [other] }, me)).toBe(true);
    expect(canManageGroup({}, null)).toBe(true);
  });

  it('treats a not-yet-loaded group as manageable', () => {
    expect(canManageGroup(undefined, me)).toBe(true);
  });

  it('lets a Marmot admin manage the group', () => {
    expect(canManageGroup({ protocol: 'marmot', adminPubkeys: [other, me] }, me)).toBe(true);
  });

  it('compares pubkeys case-insensitively', () => {
    expect(canManageGroup({ protocol: 'marmot', adminPubkeys: [me] }, me.toUpperCase())).toBe(true);
    expect(canManageGroup({ protocol: 'marmot', adminPubkeys: [me.toUpperCase()] }, me)).toBe(true);
  });

  it('blocks a Marmot non-admin', () => {
    expect(canManageGroup({ protocol: 'marmot', adminPubkeys: [other] }, me)).toBe(false);
    expect(canManageGroup({ protocol: 'marmot' }, me)).toBe(false);
  });

  it('blocks a Marmot group when the viewer is unknown', () => {
    expect(canManageGroup({ protocol: 'marmot', adminPubkeys: [other] }, null)).toBe(false);
    expect(canManageGroup({ protocol: 'marmot', adminPubkeys: [other] }, undefined)).toBe(false);
  });
});
