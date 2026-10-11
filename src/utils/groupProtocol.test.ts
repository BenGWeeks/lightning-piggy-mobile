import { groupDmProtocol } from './groupProtocol';

describe('groupDmProtocol', () => {
  it('returns marmot for a Marmot group', () => {
    expect(groupDmProtocol({ protocol: 'marmot' })).toBe('marmot');
  });

  it('defaults a group without a protocol to NIP-17', () => {
    expect(groupDmProtocol({})).toBe('nip17');
    expect(groupDmProtocol({ protocol: undefined })).toBe('nip17');
  });
});
