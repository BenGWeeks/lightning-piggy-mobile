import { messageEditDelete } from './messageEditDelete';

const ID = 'ab'.repeat(32);
const own = { isMarmot: true, fromMe: true, targetId: ID, isPlainText: true };

describe('messageEditDelete', () => {
  it('offers both on your own plain-text Marmot message', () => {
    expect(messageEditDelete(own)).toEqual({ canEdit: true, canDelete: true });
  });

  it('offers nothing outside Marmot (NIP-04 / NIP-17)', () => {
    expect(messageEditDelete({ ...own, isMarmot: false })).toEqual({
      canEdit: false,
      canDelete: false,
    });
  });

  it('offers nothing on someone else’s message', () => {
    expect(messageEditDelete({ ...own, fromMe: false })).toEqual({
      canEdit: false,
      canDelete: false,
    });
  });

  it('media / structured messages: delete only', () => {
    expect(messageEditDelete({ ...own, isPlainText: false })).toEqual({
      canEdit: false,
      canDelete: true,
    });
  });

  it('nothing until the message has its real Marmot id (still sending)', () => {
    for (const targetId of [undefined, 'local_123_abc', `local-${ID}`]) {
      expect(messageEditDelete({ ...own, targetId })).toEqual({
        canEdit: false,
        canDelete: false,
      });
    }
  });

  it('nothing while our send is still pending (or failed)', () => {
    expect(messageEditDelete({ ...own, pending: true })).toEqual({
      canEdit: false,
      canDelete: false,
    });
  });
});
