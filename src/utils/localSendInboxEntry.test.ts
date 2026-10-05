import { localSendInboxEntry } from './localSendInboxEntry';

const PEER = 'b'.repeat(64);
const base = { id: 'local-1', fromMe: true, createdAt: 10, text: 'hi' };

describe('localSendInboxEntry', () => {
  it('surfaces an outgoing NIP-04 send in the Messages list', () => {
    expect(localSendInboxEntry(PEER, { ...base, wireKind: 4 })).toEqual({
      id: 'local-1',
      partnerPubkey: PEER,
      fromMe: true,
      createdAt: 10,
      text: 'hi',
      wireKind: 4,
    });
  });

  it('leaves NIP-17 sends to their self-echo and ignores received rows', () => {
    expect(localSendInboxEntry(PEER, { ...base, wireKind: 14 })).toBeNull();
    expect(localSendInboxEntry(PEER, { ...base, wireKind: undefined })).toBeNull();
    expect(localSendInboxEntry(PEER, { ...base, fromMe: false, wireKind: 4 })).toBeNull();
  });
});
