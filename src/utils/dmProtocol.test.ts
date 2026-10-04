import {
  DEFAULT_DM_PROTOCOL,
  DM_PROTOCOL_LABEL,
  protocolForWireKind,
  latestThreadProtocol,
  isDmProtocolAvailable,
} from './dmProtocol';

describe('DM protocols', () => {
  it('defaults to NIP-17 and keeps protocol names stable', () => {
    expect(DEFAULT_DM_PROTOCOL).toBe('nip17');
    expect(DM_PROTOCOL_LABEL).toEqual({ nip04: 'NIP-04', nip17: 'NIP-17', marmot: 'Marmot' });
  });
  it.each([14, 15, 16, 17, 1068, 1018, 30078, 0])('maps kind %i to NIP-17', (kind) => {
    expect(protocolForWireKind(kind)).toBe('nip17');
  });
  it('distinguishes legacy and unknown messages', () => {
    expect(protocolForWireKind(4)).toBe('nip04');
    expect(protocolForWireKind(undefined)).toBeNull();
  });
  it('finds the newest known protocol regardless of order, skipping unknown rows', () => {
    const messages = Object.freeze([
      { createdAt: 30 },
      { createdAt: 20, wireKind: 4 },
      { createdAt: 10, wireKind: 14 },
    ]);
    expect(latestThreadProtocol(messages)).toBe('nip04');
    expect(latestThreadProtocol([...messages].reverse())).toBe('nip04');
    expect(latestThreadProtocol([])).toBeNull();
    expect(latestThreadProtocol([{ createdAt: 30 }])).toBeNull();
  });
  it('reserves Marmot without enabling it', () => {
    expect(isDmProtocolAvailable('nip04')).toBe(true);
    expect(isDmProtocolAvailable('nip17')).toBe(true);
    expect(isDmProtocolAvailable('marmot')).toBe(false);
  });
});
