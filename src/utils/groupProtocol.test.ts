import { canManageGroup, groupDmProtocol } from './groupProtocol';

describe('groupDmProtocol', () => {
  it('returns marmot for a Marmot group', () => {
    expect(groupDmProtocol({ protocol: 'marmot' })).toBe('marmot');
  });

  it('defaults a group without a protocol to NIP-17', () => {
    expect(groupDmProtocol({})).toBe('nip17');
    expect(groupDmProtocol({ protocol: undefined })).toBe('nip17');
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
