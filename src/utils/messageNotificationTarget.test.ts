import { messageNotificationTarget } from './messageNotificationTarget';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const ev = (id: string, kind: number, pubkey = A) => ({ id, kind, pubkey });

describe('messageNotificationTarget (#1154)', () => {
  it('opens the NIP-04 conversation when every new message is from one sender', () => {
    expect(messageNotificationTarget([ev('1', 4), ev('2', 4)])).toEqual({
      conversationPubkey: A,
      conversationProtocol: 'nip04',
    });
  });

  it('carries the wrap id for a single NIP-17 message', () => {
    expect(messageNotificationTarget([ev('w', 1059, 'e'.repeat(64))])).toEqual({ wrapId: 'w' });
  });

  it('falls back to the list for mixed senders, several wraps or orders', () => {
    expect(messageNotificationTarget([ev('1', 4, A), ev('2', 4, B)])).toEqual({});
    expect(messageNotificationTarget([ev('1', 1059), ev('2', 1059)])).toEqual({});
    expect(messageNotificationTarget([ev('1', 4), ev('2', 1059)])).toEqual({});
    expect(messageNotificationTarget([ev('1', 16)])).toEqual({});
    expect(messageNotificationTarget([])).toEqual({});
  });
});
