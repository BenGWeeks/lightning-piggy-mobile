import {
  DEFAULT_DM_PROTOCOL,
  DM_PROTOCOL_LABEL,
  protocolForWireKind,
  filterMessagesByProtocol,
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
  it('maps legacy to NIP-04 and missing kinds to NIP-17', () => {
    expect(protocolForWireKind(4)).toBe('nip04');
    expect(protocolForWireKind(undefined)).toBe('nip17');
  });
  it('partitions received and optimistic messages without changing order or objects', () => {
    const messages = Object.freeze([
      { id: 'legacy', wireKind: 4 },
      { id: 'unknown' },
      { id: 'local-legacy', wireKind: 4 },
      { id: 'file', wireKind: 15 },
      { id: 'local-modern', wireKind: 14 },
    ]);
    expect(filterMessagesByProtocol(messages, 'nip04')).toEqual([messages[0], messages[2]]);
    const modern = filterMessagesByProtocol(messages, 'nip17');
    expect(modern).toEqual([messages[1], messages[3], messages[4]]);
    expect(modern[0]).toBe(messages[1]);
    expect(filterMessagesByProtocol(messages, 'marmot')).toEqual([]);
    expect(filterMessagesByProtocol([], 'nip17')).toEqual([]);
  });
  it('reserves Marmot without enabling it', () => {
    expect(isDmProtocolAvailable('nip04')).toBe(true);
    expect(isDmProtocolAvailable('nip17')).toBe(true);
    expect(isDmProtocolAvailable('marmot')).toBe(false);
  });
});
